/**
 * Ownership-status badge vocabulary for photocard thumbnails.
 *
 * Extracted from PhotocardGrid so the Binder Designer's card tray and pockets
 * render the same letters and colors as the library grid. Pure move — no
 * behavior change.
 */

// Status → letter mapping
export const STATUS_LETTERS = {
  Owned: "O",
  Wanted: "W",
  Trade: "T",
  "Formerly Owned": "F",
  "Pending - Outgoing": "P",
  Borrowed: "B",
  "Pending - Incoming": "I",
  Undecided: "U",
  "Not Wanted": "N",
};

// Letter → neon color mapping
export const BADGE_LETTER_COLORS = {
  O: "var(--badge-owned)",
  W: "var(--badge-wanted)",
  T: "var(--badge-trade)",
  F: "var(--badge-formerly-owned)",
  P: "var(--badge-pending-out)",
  B: "var(--badge-borrowed)",
  I: "var(--badge-pending-in)",
  U: "var(--badge-undecided)",
  N: "var(--badge-not-wanted)",
};

// Render order for statuses that don't take the primary slot (bottom-right)
export const OTHER_STATUS_ORDER = ["T", "P", "I", "B", "F"];

// Primary slot (bottom-left) precedence. Owned wins because possession is the
// most salient fact; below it the mutually-exclusive triage decisions.
export const PRIMARY_STATUS_ORDER = ["O", "W", "N", "U"];

export function getCopyBadges(copies) {
  if (!copies || copies.length === 0) return { primary: null, other: null };

  // Count by letter
  const counts = {};
  for (const c of copies) {
    const letter = STATUS_LETTERS[c.ownership_status] || c.ownership_status[0].toUpperCase();
    counts[letter] = (counts[letter] || 0) + 1;
  }

  // Primary badge (bottom-left) — first match wins, always singular
  let primary = null;
  for (const letter of PRIMARY_STATUS_ORDER) {
    if (counts[letter]) {
      primary = { label: letter, neonColor: BADGE_LETTER_COLORS[letter] };
      break;
    }
  }

  // Other statuses badge (bottom-right) — everything not in the primary slot
  let other = null;
  const otherParts = [];
  for (const letter of OTHER_STATUS_ORDER) {
    if (counts[letter]) {
      otherParts.push({ letter, count: counts[letter], color: BADGE_LETTER_COLORS[letter] || "var(--badge-default)" });
    }
  }
  if (otherParts.length > 0) {
    other = otherParts;
  }

  return { primary, other };
}
