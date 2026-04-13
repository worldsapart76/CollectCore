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

export const libraryState = {
  filters: null,    // null = use DEFAULT_FILTERS on first mount
  sortMode: "default",
  viewMode: "fronts",
  sizeMode: "m",
  showCaptions: true,
  pageSize: 30,
};

export const exportState = {
  filters: null,    // null = use DEFAULT_FILTERS on first mount
  sortMode: "default",
  includeCaptions: true,
  includeBacks: false,
};
