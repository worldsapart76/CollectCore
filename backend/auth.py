"""
Identity & authorization for the authenticated `/pcs/` guest tier.

CollectCore historically had ZERO auth code — Cloudflare Access gates the apex
+ api hosts at the edge and the app trusts whoever arrives. The `/pcs/` tier
introduces the first app-layer authorization, because it lets non-admin Google
accounts through the edge and must (a) identify each guest to scope their rows
and (b) keep guests out of admin endpoints.

Model: Cloudflare Access authenticates (proves identity + enforces the
allowlist at the edge); this module authorizes per request.

  get_identity(request) -> verified email (lowercased) or None
  is_admin(email)       -> True if email is in ADMIN_EMAILS (or the dev admin)
  require_user(request) -> FastAPI dependency; 401 if unauthenticated
  require_admin(request)-> FastAPI dependency; 403 if not an admin

Identity source is the `Cf-Access-Authenticated-User-Email` header injected by
Cloudflare Access. On localhost (no CF edge) a dev identity is synthesized so
local workflows keep working: it defaults to an admin, but set DEV_USER_EMAIL
to a non-admin address to exercise the guest paths locally.

HARDENING (Phase 3 — see docs/guest_cloud_accounts_plan.md §3.1): verify the
signed `Cf-Access-Jwt-Assertion` JWT instead of trusting the plaintext email
header. The plaintext header is forgeable by anyone who can reach the Railway
origin directly (the public *.up.railway.app URL bypasses Cloudflare). JWT
verification needs the CF team domain + application audience tag, configured
during the Phase 3 infra work, so it lands then — alongside enabling the admin
gate (PCS_ADMIN_GATE) in prod.
"""

import functools
import logging
import os

from fastapi import HTTPException, Request

logger = logging.getLogger("collectcore.auth")

CF_EMAIL_HEADER = "cf-access-authenticated-user-email"
CF_JWT_HEADER = "cf-access-jwt-assertion"

# Synthetic local-dev identity (no CF edge on localhost). Treated as admin so
# existing local admin workflows keep working without configuration.
DEV_ADMIN_EMAIL = "dev-admin@localhost"


def _admin_emails() -> set[str]:
    """Admin allowlist from the ADMIN_EMAILS env var (comma-separated)."""
    return {
        e.strip().lower()
        for e in os.environ.get("ADMIN_EMAILS", "").split(",")
        if e.strip()
    }


def _is_local_request(request: Request) -> bool:
    host = request.headers.get("host", "").split(":")[0].lower()
    return host in ("localhost", "127.0.0.1")


def _dev_identity(request: Request) -> str | None:
    """Synthesized identity for localhost dev; None off localhost."""
    if _is_local_request(request):
        return (os.environ.get("DEV_USER_EMAIL") or DEV_ADMIN_EMAIL).strip().lower()
    return None


# ── Cloudflare Access JWT verification (hardening) ─────────────────────────
# When CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set, verify the signed
# `Cf-Access-Jwt-Assertion` JWT rather than trusting the plaintext email
# header (which anyone who can reach the Railway origin directly could forge).
# Unset → legacy plaintext-header trust (unchanged behavior). PyJWT is imported
# lazily so the app boots without it when verification is disabled.

def _team_domain() -> str:
    d = os.environ.get("CF_ACCESS_TEAM_DOMAIN", "").strip()
    if not d:
        return ""
    return d.replace("https://", "").replace("http://", "").rstrip("/")


def _audiences() -> list[str]:
    """Accepted CF Access application audience (AUD) tags (CF_ACCESS_AUD,
    comma-separated).

    Each Access application signs its JWTs with its OWN aud tag, so a multi-app
    setup (the domain-wide admin app + the path-scoped `CollectCore PCS` app)
    must accept BOTH — otherwise a token issued by one app is rejected on
    requests authenticated to the other (e.g. only the PCS aud → admin's JWT
    fails the audience check → admin gets locked out by the admin gate). PyJWT
    passes a token whose `aud` claim matches ANY entry in this list.
    """
    return [a.strip() for a in os.environ.get("CF_ACCESS_AUD", "").split(",") if a.strip()]


def _jwt_verification_enabled() -> bool:
    return bool(_team_domain() and _audiences())


@functools.lru_cache(maxsize=1)
def _jwk_client():
    import jwt  # PyJWT (lazy)
    return jwt.PyJWKClient(f"https://{_team_domain()}/cdn-cgi/access/certs")


def _email_from_jwt(token: str) -> str | None:
    import jwt  # PyJWT (lazy)
    signing_key = _jwk_client().get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=_audiences(),
        issuer=f"https://{_team_domain()}",
    )
    email = payload.get("email")
    return email.strip().lower() if email else None


def get_identity(request: Request) -> str | None:
    """The caller's verified email (lowercased), or None if unauthenticated."""
    if _jwt_verification_enabled():
        # Hardened path: trust ONLY the signed assertion, never the plaintext
        # header. A missing/invalid token off localhost is unauthenticated.
        token = request.headers.get(CF_JWT_HEADER)
        if token:
            try:
                email = _email_from_jwt(token)
                if email:
                    return email
            except Exception as exc:  # invalid / expired / wrong aud
                logger.warning("CF Access JWT verification failed: %s", exc)
        return _dev_identity(request)

    # Legacy path: no JWT config → trust the plaintext identity header.
    raw = request.headers.get(CF_EMAIL_HEADER)
    if raw and raw.strip():
        return raw.strip().lower()
    return _dev_identity(request)


def is_admin(email: str | None) -> bool:
    if not email:
        return False
    e = email.lower()
    if e == DEV_ADMIN_EMAIL:
        return True
    return e in _admin_emails()


def require_user(request: Request) -> str:
    """FastAPI dependency: returns the caller's email or raises 401."""
    email = get_identity(request)
    if not email:
        raise HTTPException(status_code=401, detail="Authentication required")
    return email


def require_admin(request: Request) -> str:
    """FastAPI dependency: returns the caller's email or raises 401/403."""
    email = require_user(request)
    if not is_admin(email):
        raise HTTPException(status_code=403, detail="Admin access required")
    return email
