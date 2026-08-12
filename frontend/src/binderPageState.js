// View-state store for the Binder Designer (dev-only page).
//
// Same mechanism as photocardPageState: a module-level object that survives
// React navigation via the JS module cache, so bouncing to the library and back
// doesn't reset your filters or drop you on page 1 of the binder.
//
// Deliberately holds no binder *content* — pages and slots always come from the
// server, so a stale tab can never resurrect an old layout over a saved one.

const STORAGE_KEY_BINDER = "binder.lastBinderId";

function readLastBinderId() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY_BINDER), 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function persistLastBinderId(id) {
  try {
    if (id == null) localStorage.removeItem(STORAGE_KEY_BINDER);
    else localStorage.setItem(STORAGE_KEY_BINDER, String(id));
  } catch {
    // Private-mode / quota failures are not worth surfacing here.
  }
}

export const binderDesignerState = {
  binderId: readLastBinderId(),
  filters: null,        // null = use DEFAULT_FILTERS on first mount
  sortMode: "default",
  viewMode: "page",     // 'page' | 'spread' (desktop only — phones force 'page')
};
