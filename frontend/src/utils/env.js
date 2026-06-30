// Build-time runtime flags. Frozen at Vite build time, so they're safe for
// gating UI and for tree-shaking admin-only code out of the guest bundle.
//
// IMPORTANT: keep the expression below dead-code-elimination friendly. Vite
// inlines `import.meta.env.VITE_IS_ADMIN` as a literal string ("true" /
// "false") at build time. A simple `=== "true"` comparison constant-folds to
// `true` or `false`, which Rollup then uses to eliminate `if (isAdmin)`
// branches in the guest bundle. Avoid wrapping with String()/toLowerCase() —
// those are runtime calls Rollup won't fold.
export const isAdmin = import.meta.env.VITE_IS_ADMIN === "true";

// True only in the authenticated `/pcs/` guest-tier build. Same dead-code-
// elimination rules as isAdmin above — keep the comparison a bare literal.
export const isPcs = import.meta.env.VITE_IS_PCS === "true";

// True ONLY for the legacy WASM `/guest/` build — the one tier that uses
// browser-local SQLite (sqliteService → worker → sqlite-wasm). Both admin and
// the server-backed /pcs/ tier are false here. Use this (not `!isAdmin`) to
// gate any local-SQLite import so the /pcs build tree-shakes the wasm graph
// out. Constant-folds the same way isAdmin does.
export const isGuestWasm =
  import.meta.env.VITE_IS_ADMIN !== "true" &&
  import.meta.env.VITE_IS_PCS !== "true";
