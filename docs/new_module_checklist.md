# New Module Checklist

> Split out of `CLAUDE.md` 2026-05-15. All 8 modules are v1-complete and no new
> modules are currently planned, so this is reference-only — consult it if a
> new collection module is ever added.

## Backup coverage

The SQLite backup (`GET /admin/backup`) is a complete hot-copy of the entire
database, so any tables added by a future module are captured automatically.
The images directory is backed up wholesale. **New modules require no backup
changes** unless they store file assets outside `images/library/`.

## Checklist when building a new module

1. Add the module's route prefix to `PROXY_PATHS` in `frontend/vite.config.js`.
   Used by the local Vite dev server only, but omitting it causes all API
   calls during `npm run dev` to return HTML instead of JSON, producing:
   `Unexpected token '<', "<!doctype "... is not valid JSON`
2. Verify that any module-specific file assets stored outside `images/library/`
   are covered by the backup. If a new module stores files in a different
   directory, update `GET /admin/backup` to include that directory in the ZIP.
3. If the module's API path could collide with a SPA route name
   (e.g., `/photocards/library` matching both an API and a SPA path), the
   `spa_host_routing` middleware in `main.py` already handles this correctly
   for the apex host. No changes needed; just be aware.
4. After deploying: rebuild dist (`npm run build`) and commit
   `backend/frontend_dist/` so the SPA picks up the new module.
