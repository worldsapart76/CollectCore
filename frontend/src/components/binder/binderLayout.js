/**
 * Pocket-page geometry for the Binder Designer.
 *
 * Layout codes read as ACROSS x DOWN (columns x rows) — a "4x3" sheet is 4
 * pockets across and 3 down, which is the 12-pocket page. Slots are row-major
 * and 0-based: slot_index = row * cols + col.
 *
 * The pocket counts are duplicated in backend/routers/binders.py for payload
 * validation. Four integers; not worth a shared source of truth.
 */

export const LAYOUTS = {
  "2x2": { cols: 2, rows: 2, label: "2 across × 2 down — 4 pockets" },
  "3x2": { cols: 3, rows: 2, label: "3 across × 2 down — 6 pockets" },
  "3x3": { cols: 3, rows: 3, label: "3 across × 3 down — 9 pockets" },
  "4x3": { cols: 4, rows: 3, label: "4 across × 3 down — 12 pockets" },
};

export const LAYOUT_CODES = Object.keys(LAYOUTS);

export const DEFAULT_LAYOUT_CODE = "4x3";

// The 6- and 12-pocket layouts were first written with rows and columns the
// wrong way round. `db.py` rewrites stored codes on startup; this map keeps a
// page loaded from an un-migrated DB from rendering as an unknown layout.
const LEGACY_CODES = { "2x3": "3x2", "3x4": "4x3" };

export function normalizeLayoutCode(code) {
  return LEGACY_CODES[code] || code;
}

export function layoutOf(code) {
  return LAYOUTS[normalizeLayoutCode(code)] || LAYOUTS[DEFAULT_LAYOUT_CODE];
}

export function pocketCount(code) {
  const { cols, rows } = layoutOf(code);
  return cols * rows;
}

/**
 * Where a pocket appears when you flip the sheet over.
 *
 * Turning a page reverses the columns but not the rows, so the card at
 * (row, col) shows its back at (row, cols - 1 - col). The function is its own
 * inverse — mirroring a mirrored index gives the original.
 */
export function mirrorSlot(slotIndex, cols) {
  const row = Math.floor(slotIndex / cols);
  const col = slotIndex % cols;
  return row * cols + (cols - 1 - col);
}

// ─── Fitting a sheet to the space available ──────────────────────────────────
// Sheets are sized to fill their container rather than picked from fixed
// presets, so a wide monitor shows a big binder and a phone shows a small one,
// and neither ever scrolls. Every piece of chrome that eats space is declared
// here so the measurement and the rendering can't drift apart.

export const CARD_ASPECT = 0.72;        // pocket width / height, matching the library grid
export const SHEET_PADDING = 8;         // inside the sheet, around the pocket grid
export const SHEET_BORDER = 1;
export const SLOT_GAP = 6;              // between pockets
export const SHEET_LABEL_HEIGHT = 22;   // "Page 2 — front" caption above each sheet
export const SPREAD_GAP = 20;           // between the two sheets of a spread
export const CANVAS_PADDING = 12;       // around the whole sheet area
export const MIN_POCKET_WIDTH = 40;

/**
 * Largest pocket width that lets `sheets` sheets fit inside width x height
 * without overflowing either axis. Returns a whole number of pixels — sub-pixel
 * widths round up during layout and can reintroduce the scrollbar we're
 * avoiding.
 */
export function fitPocketWidth({ width, height, layoutCode, sheets = 1 }) {
  const { cols, rows } = layoutOf(layoutCode);
  const sheetChromeX = (SHEET_PADDING + SHEET_BORDER) * 2;

  const usableWidth = width - CANVAS_PADDING * 2 - (sheets - 1) * SPREAD_GAP;
  const byWidth = (usableWidth / sheets - sheetChromeX - (cols - 1) * SLOT_GAP) / cols;

  const usableHeight =
    height - CANVAS_PADDING * 2 - SHEET_LABEL_HEIGHT - sheetChromeX;
  const byHeight = ((usableHeight - (rows - 1) * SLOT_GAP) / rows) * CARD_ASPECT;

  return Math.max(MIN_POCKET_WIDTH, Math.floor(Math.min(byWidth, byHeight)));
}

export function pocketHeight(pocketWidth) {
  return Math.round(pocketWidth / CARD_ASPECT);
}

/** Outer size of a rendered sheet, so covers can match it exactly. */
export function sheetSize(pocketWidth, layoutCode) {
  const { cols, rows } = layoutOf(layoutCode);
  const chrome = (SHEET_PADDING + SHEET_BORDER) * 2;
  return {
    width: cols * pocketWidth + (cols - 1) * SLOT_GAP + chrome,
    height: rows * pocketHeight(pocketWidth) + (rows - 1) * SLOT_GAP + chrome,
  };
}
