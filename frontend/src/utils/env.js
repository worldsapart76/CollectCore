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
