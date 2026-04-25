// Module-level state stores for the three photocard pages.
// These persist as long as the app is running (JS module cache survives React navigation).

export const inboxState = {
  groupId: "",
  categoryId: "",
  ownershipStatusId: "",
  selectedMemberIds: [],
  sourceOriginId: "",
  isSpecial: false,
  version: "",
  notes: "",
};

const STORAGE_KEY_MCPR = "photocard.mobileCardsPerRow";

function readMobileCardsPerRow() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY_MCPR), 10);
    return Number.isFinite(v) && v >= 2 && v <= 8 ? v : 3;
  } catch { return 3; }
}

export function persistMobileCardsPerRow(n) {
  try { localStorage.setItem(STORAGE_KEY_MCPR, String(n)); } catch {}
}

export const libraryState = {
  filters: null,    // null = use DEFAULT_FILTERS on first mount
  sortMode: "default",
  viewMode: "fronts",
  sizeMode: "m",
  showCaptions: true,
  pageSize: 30,
  mobileCardsPerRow: readMobileCardsPerRow(),
};

export const exportState = {
  filters: null,    // null = use DEFAULT_FILTERS on first mount
  sortMode: "default",
  includeCaptions: true,
  includeBacks: false,
};
