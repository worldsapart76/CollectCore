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

import os

from fastapi import HTTPException, Request

CF_EMAIL_HEADER = "cf-access-authenticated-user-email"

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


def get_identity(request: Request) -> str | None:
    """The caller's verified email (lowercased), or None if unauthenticated."""
    raw = request.headers.get(CF_EMAIL_HEADER)
    if raw and raw.strip():
        return raw.strip().lower()
    if _is_local_request(request):
        return (os.environ.get("DEV_USER_EMAIL") or DEV_ADMIN_EMAIL).strip().lower()
    return None


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
