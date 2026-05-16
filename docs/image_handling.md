# Image Handling

> Split out of `CLAUDE.md` 2026-05-15. The two-phase inbox pipeline summary
> stays in CLAUDE.md; this doc holds the production-state detail and rendering
> helpers needed when working on image code.

Photocards use a two-phase inbox pipeline: front images create records, back
images attach to existing records. Implemented in `InboxPage.jsx` +
`backend/routers/ingest.py`.

## Production state (post-cutover 2026-04-24)

- All photocard images live in R2 under `catalog/images/{catalog_item_id}_{f|b}.jpg`
  (resized to 600×924 JPEG q80). `tbl_attachments.storage_type = 'hosted'`,
  `file_path` is the full R2 URL via `images.collectcoreapp.com`.
- All non-photocard cover images live in R2 under
  `admin/images/{module}/{module}_{id:06d}.jpg` (long-edge 1200px JPEG q85).
  `cover_image_url` is the full R2 URL.
- Local-tier ingest still writes files to `images/library/` and rows with
  `storage_type='local'` initially, but admin tools (`tools/publish_catalog.py`
  for photocards, `tools/sync_admin_images.py` for cover images) sweep them
  to R2 and rewrite the DB rows. Direct-to-R2 ingest is future work.
- Local-only paths to know:
  - Staging during ingest: `images/inbox/` → `images/library/` (then swept to R2)
  - Filename convention: `{group_code}_{id:06d}_{f|b}.{ext}`
  - Cache busting via `?v=mtime` (relevant for local-mode rows only; R2 URLs
    use immutable filenames)

## Image rendering helpers

- Photocards: `resolveCardSrc()` in
  [PhotocardGrid.jsx](../frontend/src/components/photocard/PhotocardGrid.jsx)
  passes `https://` URLs through and falls back to local-path + cache-buster
  for newly-ingested cards awaiting next publish.
- Non-photocards: `getImageUrl()` shared helper. Renders R2 URLs unchanged.
