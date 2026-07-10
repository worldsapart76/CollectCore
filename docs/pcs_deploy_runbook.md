# `/pcs/` Deploy Runbook (Authenticated Guest Tier)

Deploy-time checklist for the authenticated `/pcs/` cloud guest tier. Companion
to `docs/guest_cloud_accounts_plan.md` (design) and `docs/guest_deploy_runbook.md`
(the deprecated WASM tier). Code for Phases 1–3 is complete on branch `pcs-tier`;
this covers the manual infra + the production cutover.

## What ships
- Backend: `pcs_users` + `pcs_card_copies` tables, `/pcs/*` API, app-layer
  authorization (`auth.py`), `/pcs/*` SPA serving.
- Frontend: `frontend_dist_pcs` bundle served at `collectcoreapp.com/pcs/*`.
- Two new safety switches (env vars): the admin authorization gate and optional
  CF Access JWT verification.

## The security model (read first)
Cloudflare Access **authenticates** (proves identity + enforces the allowlist at
the edge). The app **authorizes**:
- `/pcs/*` → any authenticated email (rows scoped to that user).
- `/catalog/*`, `/guest` → public (existing bypass).
- everything else (admin SPA + all module/admin APIs) → must be an admin email,
  **enforced only when `PCS_ADMIN_GATE=1`**.

Opening `/pcs/` to non-admin Google accounts is what makes the admin gate
load-bearing. **Set `ADMIN_EMAILS` and verify it BEFORE enabling the gate**, or
you can 403 yourself out of the admin app.

## Step 1 — Railway env vars
Set on the CollectCore service (Railway → Variables):
- `ADMIN_EMAILS` = your admin Google email(s), comma-separated
  (e.g. `worldsapart76@gmail.com`). **Required.**
- Leave `PCS_ADMIN_GATE` **unset** for now (enable in Step 5).
- Leave `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` **unset** for now (Step 6).

## Step 2 — Deploy the code
1. Merge `pcs-tier` → `main` (fast-forward or PR), or cherry-pick.
2. `git push origin main` → Railway auto-deploys.
3. Confirm boot: Railway logs show no errors; `GET https://api.collectcoreapp.com/health` OK.
4. Confirm the bundle is present: `GET https://collectcoreapp.com/pcs/` returns HTML
   referencing `/pcs/pcs-assets/…` (may be behind CF Access until Step 3).

> Note: `requirements.txt` now includes `PyJWT[crypto]`. It's only imported when
> JWT verification is enabled (Step 6), but it will be installed at build time.

## Step 3 — Cloudflare Access: allow guests onto `/pcs/`
In Cloudflare Zero Trust → Access → Applications, on the existing apex+api
application (team `collectcore`):
- Add an **Allow** policy scoped to path `/pcs*` (apex **and** api host) whose
  **Include** rule is *Emails* = your friends' Google addresses (the allowlist).
- Keep the existing admin policy (admin email only) for everything else.
- Keep the `/catalog/*` and `/guest` **bypass** policies unchanged.

Verify: a friend on the allowlist can load `collectcoreapp.com/pcs/` after Google
sign-in; a non-allowlisted account is blocked at the edge.

## Step 4 — Smoke test (header-trust mode)
As an allowlisted friend:
1. Load `collectcoreapp.com/pcs/` → photocard library renders (catalog cards).
2. Open a card → "Your copies" → add **Owned** + a note → reload → it persists.
3. Filter to **Catalog** → shows unowned cards. Bulk-select a few → Bulk Update →
   Wanted → confirm → reload persists.
4. Hamburger menu shows "Signed in as <email>" + Sign out.
5. As the admin, confirm the admin app at `collectcoreapp.com/` still works.

## Step 5 — Enable the admin authorization gate
Only after Step 4 passes and `ADMIN_EMAILS` is confirmed:
1. Set `PCS_ADMIN_GATE=1` on Railway → redeploy.
2. Verify **admin**: `collectcoreapp.com/` and admin APIs still work for you.
3. Verify **guest**: an allowlisted friend can still use `/pcs/` but a direct hit
   to an admin endpoint (e.g. `api.collectcoreapp.com/photocards`) returns 403.

Rollback: unset `PCS_ADMIN_GATE` → redeploy (reverts to pre-gate behavior).

## Step 6 — (Recommended) CF Access JWT hardening
Closes the forgeable-plaintext-header hole (the Railway origin is reachable
directly, bypassing Cloudflare). Do this carefully — a misconfig 401s everyone.
1. In CF Zero Trust, note the application **AUD** tag and your team domain
   (`<team>.cloudflareaccess.com`).
2. Set `CF_ACCESS_TEAM_DOMAIN` = `collectcore.cloudflareaccess.com` (or your team)
   and `CF_ACCESS_AUD` = the AUD tag → redeploy.
3. Verify admin + a guest can both still sign in and use the app. Once enabled,
   the plaintext `Cf-Access-Authenticated-User-Email` header is ignored — only
   the signed `Cf-Access-Jwt-Assertion` is trusted.

Rollback: unset both vars → redeploy (reverts to header trust).

Optional belt-and-suspenders: restrict the Railway origin to Cloudflare IP ranges
so the public `*.up.railway.app` URL can't be hit directly at all.

## Rollback (whole tier)
`/pcs/` is additive. To disable: remove the CF Access guest policy (guests can no
longer reach it). To fully revert, redeploy `main` without the `pcs-tier` commits.
No admin/catalog/guest data is touched by this tier.

## After launch
- The deprecated WASM `/guest/` tier is untouched by this deploy. Its sunset
  (redirect `/guest/*` → `/pcs/`, optional one-time backup-JSON importer) is
  Phase 4 of `docs/guest_cloud_accounts_plan.md`.
