// Build-time runtime flags. Desktop admin build sets VITE_IS_ADMIN=true via
// .env.local or the Electron build script; guest mobile build leaves it unset.
// These values are frozen at Vite build time, so they're safe for gating UI.
export const isAdmin =
  String(import.meta.env.VITE_IS_ADMIN ?? "").toLowerCase() === "true";
