# Photocard Module — Token-Only Migration Plan

Reference doc for executing Plan **B** on the photocard module after the 7-module
primitive-based migration (Board Games, TTRPG, Graphic Novels, Books, Music,
Video, Video Games). Photocards was analyzed and deliberately routed to a
different approach because its architecture doesn't match the other seven.

This doc is self-contained so a fresh session can execute it without re-reading
the prior analysis.

---

## Background (short)

- Parent initiative: [docs/design_system_audit.md](design_system_audit.md),
  deferred item #1 in [CLAUDE.md](../CLAUDE.md).
- 7 of 8 modules have been migrated to the primitive set in
  [frontend/src/components/primitives/](../frontend/src/components/primitives/).
- Photocards was deferred and given its own plan because:
  1. It already centralizes styles into `const styles = { ... }` objects
     (not inline `style={{}}` scattered through JSX), so the "hex literals
     everywhere" problem was never as bad as the other modules'.
  2. Its detail modal, bulk edit, and grid have bespoke features (prev/next
     nav, dirty-state, image replacement, 7-color neon badge overlay system,
     two-phase inbox pipeline) that don't cleanly map to `<Modal>` / primitives
     without escape hatches that erode the primitive value.
  3. 4,724 records + the module's maturity make a full JSX rewrite high-risk.

## Goal

Token-only migration: replace hex literals with CSS variable references,
add missing badge tokens, recolor blue→green per §3.1 of the audit. **No JSX
restructuring.** No primitive adoption. The `const styles = { ... }` blocks
stay put; only their *values* change.

Outcome when done:
- Dark mode renders the photocard module correctly (primary fix: `#fff` modal
  background → `--bg-base`).
- `commonStyles.js` can be deleted without touching photocard code (photocard
  files never imported it).
- Module visual style stays identical in light mode; dark mode becomes usable.

---

## Files in scope

| File | Size | Local styles pattern | Priority |
|---|---|---|---|
| [frontend/src/components/photocard/PhotocardFilters.jsx](../frontend/src/components/photocard/PhotocardFilters.jsx) | 142 | none (thin shim) | skip — already clean |
| [frontend/src/pages/PhotocardLibraryPage.jsx](../frontend/src/pages/PhotocardLibraryPage.jsx) | 660 | `const styles = {}` block at bottom | 1 |
| [frontend/src/components/photocard/PhotocardGrid.jsx](../frontend/src/components/photocard/PhotocardGrid.jsx) | 411 | `const styles = {}` block at bottom + badge color map at top | 2 |
| [frontend/src/components/photocard/PhotocardBulkEdit.jsx](../frontend/src/components/photocard/PhotocardBulkEdit.jsx) | 547 | scattered inline styles | 3 |
| [frontend/src/components/photocard/PhotocardDetailModal.jsx](../frontend/src/components/photocard/PhotocardDetailModal.jsx) | 900 | `const styles = {}` block at bottom (~200 lines) | 4 |
| [frontend/src/pages/InboxPage.jsx](../frontend/src/pages/InboxPage.jsx) | 901 | local `labelStyle`/`inputStyle`/`btnPrimary`/etc. consts at top | 5 |
| [frontend/src/InboxManager.jsx](../frontend/src/InboxManager.jsx) | 387 | scattered inline | **open question — see below** |

**Filters file can be skipped entirely** — 0 hex, just passes through to shared
`FilterSidebar` primitives.

## Token additions required

Three new badge color tokens for the expanded photocard ownership palette
(grey / orange / sky-blue for F/P/I — the existing 4 in `app.css` cover
only O/W/T/B).

Add these to **both themes** in [frontend/src/styles/app.css](../frontend/src/styles/app.css),
inside the existing "Ownership badge palette" block:

**Light + Dark (neon, identical across themes, same as existing badge tokens):**
```css
--badge-formerly-owned:  #607d8b;   /* grey — Formerly Owned (F) */
--badge-pending-out:     #ff9900;   /* neon orange — Pending Outgoing (P) */
--badge-pending-in:      #00bfff;   /* sky blue — Pending Incoming (I) */
```

Per decision §3.3, the neon badge palette is kept intentional and high-saturation
in both themes — same rule applies here.

Also add (both themes — identical, intentional signal colors):
```css
--accent-special:        #f5c518;   /* star badge ★ color */
--accent-special-shadow: #000000;   /* 4-way text-shadow for star readability */
```

No other new tokens needed. Everything else maps to existing tokens from the
audit in §1.4 of [design_system_audit.md](design_system_audit.md).

---

## Hex → token mapping (canonical)

Apply this mapping everywhere across the 6 files. Tokens in **bold** are new
from this plan; everything else already exists in `app.css`.

### Surfaces / backgrounds

| Hex | Used for | Token |
|---|---|---|
| `#fff` | Modal panel bg, button bg, white surfaces | `var(--bg-base)` |
| `#f5f5f5` | Secondary-button bg, cell bg (grid) | `var(--bg-surface)` |
| `#fafafa` | Upload zone idle bg, detail modal image panel bg | `var(--bg-surface)` |
| `#f9f9f9` | Member chip bg, grid cell bg | `var(--bg-surface)` |
| `#f2fde8` | Upload zone hover bg | `var(--green-light)` |
| `#eee` | Image placeholder slot bg | `var(--bg-surface)` |

### Borders

| Hex | Used for | Token |
|---|---|---|
| `#ccc` | Default input/select border | `var(--border-input)` |
| `#ddd` | Member chip border | `var(--border-input)` |
| `#e0e0e0` | Modal header/footer divider, caption divider | `var(--border)` |
| `#bbb` | Upload-zone idle dashed border | `var(--border-input)` |

### Text

| Hex | Used for | Token |
|---|---|---|
| `#111`, `#333` | Body / high-contrast text | `var(--text-primary)` |
| `#444`, `#555` | Label text, input text | `var(--text-secondary)` |
| `#666`, `#777`, `#888`, `#999` | Muted / placeholder / caption | `var(--text-muted)` |
| `#bbb` *(when used as text)* | Image-placeholder text | `var(--text-muted)` |

### Buttons + actions

| Hex | Used for | Token |
|---|---|---|
| `#377e00` | Primary-button green | `var(--btn-primary-bg)` |
| `#1565c0` | Blue "Save" / bulk-apply buttons, select overlay `<div>` | **Recolor to green**: `var(--btn-primary-bg)` per §3.1 |
| `#c62828` | Error text, delete button border/text | `var(--danger-text)` for text; `var(--btn-danger-bg)` for solid |
| `#ffebee` | Error alert bg | `var(--error-bg)` |
| `#2e7d32` | Success border | `var(--success-border)` |
| `#e8f5e9` | Success alert bg | `var(--success-bg)` |

### Ownership badge palette (PhotocardGrid)

In [PhotocardGrid.jsx](../frontend/src/components/photocard/PhotocardGrid.jsx)
top-of-file `BADGE_LETTER_COLORS` object, replace the 7 hex values with token refs:

```js
const BADGE_LETTER_COLORS = {
  O: "var(--badge-owned)",
  W: "var(--badge-wanted)",
  T: "var(--badge-trade)",
  F: "var(--badge-formerly-owned)",     // NEW token
  P: "var(--badge-pending-out)",        // NEW token
  B: "var(--badge-borrowed)",
  I: "var(--badge-pending-in)",         // NEW token
};
```

The fallback `|| "#fff"` in `getCopyBadges` → `var(--badge-default)` (already exists).

Badge background `#000` (the black overlay behind neon letters) → `var(--badge-bg)`
(already exists).

### Special-star badge

In [PhotocardGrid.jsx](../frontend/src/components/photocard/PhotocardGrid.jsx),
`styles.specialBadge`:

```js
// BEFORE
color: "#f5c518",
textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",

// AFTER
color: "var(--accent-special)",
textShadow: "-1px -1px 0 var(--accent-special-shadow), 1px -1px 0 var(--accent-special-shadow), -1px 1px 0 var(--accent-special-shadow), 1px 1px 0 var(--accent-special-shadow)",
```

### Overlay / shadows

| Hex | Used for | Token |
|---|---|---|
| `rgba(0,0,0,0.45)` / `rgba(0,0,0,0.5)` | Modal overlay backdrop | Leave as-is (raw rgba is fine here — matches `.cc-modal-overlay` in `primitives.css`) |
| `0 4px 24px rgba(0,0,0,0.2)` | Detail modal box-shadow | `var(--shadow-modal)` |
| `0 2px 12px rgba(0,0,0,0.15)` | Bulk edit panel box-shadow | `var(--shadow-modal)` |

### Font sizes (Photocards specifically)

Numeric `fontSize:` values are pervasive. Map to the scale:

| Numeric | Token |
|---|---|
| `10` | keep as `"10px"` (below `--text-xs`; micro-caption) |
| `11` | `var(--text-xs)` |
| `12` | `var(--text-sm)` |
| `13` | `var(--text-base)` |
| `14`, `15` | `var(--text-md)` |
| `16` | keep as `"16px"` (close button ✕) |
| `18` | keep as `"18px"` (nav arrows) |
| `26` | keep as `"26px"` (special star) |

### Border-radius

| Numeric | Token |
|---|---|
| `3` | `var(--radius-sm)` |
| `4` | `var(--radius-md)` |
| `6` | `var(--radius-lg)` |

### Spacing

Spacing values (`padding`, `margin`, `gap`) are fine as numeric pixel values
for this pass — tokenizing all of them is out of scope here and would balloon
the diff. The audit's spacing scale migration is a separate concern.

**Exception:** the `padding` on modal headers/footers/bodies should stay
numeric since they match primitive `<Modal>` geometry by coincidence; no need
to touch them.

---

## File-by-file execution

### 1. [PhotocardFilters.jsx](../frontend/src/components/photocard/PhotocardFilters.jsx) — **SKIP**

0 hex, 0 inline colors. It's already a pure shim over `FilterSidebar`.

### 2. [PhotocardLibraryPage.jsx](../frontend/src/pages/PhotocardLibraryPage.jsx)

- 1 hex: `#c62828` in the error-state render (line 352). Replace with
  `var(--error-text)` (or use `<Alert tone="error">` — this one's low-risk
  because it's a 3-line error fallback; primitive swap optional).
- The bottom `const styles = { ... }` block (lines 553–660) already uses
  `var(--*)` tokens. **Already clean — no changes needed.**

### 3. [PhotocardGrid.jsx](../frontend/src/components/photocard/PhotocardGrid.jsx)

- Top-of-file `BADGE_LETTER_COLORS` — replace with token refs (see above).
- `OTHER_STATUS_ORDER` fallback `"#fff"` → `var(--badge-default)`.
- Empty-state div at ~line 105 (`color: "#999"`) → `var(--text-muted)`.
- Bottom `const styles = { ... }` block (lines 284–411) — replace ~12 hex
  values per the mapping table. `#1565c0` in `selectOverlay.background` →
  `var(--btn-primary-bg)` per §3.1.
- `styles.specialBadge` → use `--accent-special` and `--accent-special-shadow`.

### 4. [PhotocardBulkEdit.jsx](../frontend/src/components/photocard/PhotocardBulkEdit.jsx)

Has scattered inline styles rather than a single `styles` object. Work
through the file replacing hex inline:
- All `#fff`, `#f5f5f5`, `#ccc`, `#e0e0e0`, `#666`, `#888`, `#1565c0`,
  `#c62828`, `#ffebee`, `#2e7d32` → tokens per mapping.
- The "Apply to N" button at the bottom is blue (`#1565c0`) — green per §3.1.
- Delete-confirm inline button pair has the standard danger pattern — keep
  structure but use tokens.

### 5. [PhotocardDetailModal.jsx](../frontend/src/components/photocard/PhotocardDetailModal.jsx)

Biggest file. Bottom `const styles = { ... }` block (lines 713–900) is where
most of the hex lives (~15 distinct colors). Apply the mapping table
wholesale to that block.

Key replacements to watch:
- `modal.background: "#fff"` → `var(--bg-base)` (**this is the dark-mode fix**).
- `imagePanel.background: "#fafafa"` → `var(--bg-surface)`.
- `modalHeader.borderBottom` and `actions.borderTop` `#e0e0e0` → `var(--border)`.
- `saveBtn.background: "#1565c0"` → `var(--btn-primary-bg)`; `saveBtn.border`
  likewise → `var(--btn-primary-bg)`.
- `deleteBtn.border: "#c62828"`, `.color: "#c62828"` → `var(--danger-text)`
  for both (outline danger style).
- The inline `FormRow` helper at ~line 702 has `color: "#555"` → `var(--text-secondary)`.
- `navBtn` (prev/next arrow) uses `#ccc` border and `#f5f5f5` bg → tokens.

Inline JSX also has a few stragglers (search for `#` in the JSX area 1–712).

### 6. [InboxPage.jsx](../frontend/src/pages/InboxPage.jsx)

**Highest hex density (57 refs).** The file has its own local copies of the
`labelStyle / inputStyle / selectStyle / btnPrimary / btnSecondary / btnSm /
alertError / alertSuccess` consts at the top (lines 35–42), with raw hex
values. These need migrating:

```js
// BEFORE (lines 35–42)
const labelStyle = { ...color: "#444" };
const selectStyle = { ...border: "1px solid #ccc" };
const inputStyle = { ...border: "1px solid #ccc", ... };
const btnPrimary = { ...background: "#377e00", color: "#fff", ... };
const btnSecondary = { ...background: "#f5f5f5", color: "#333", border: "1px solid #ccc", ... };
const btnSm = { ...background: "#f5f5f5", border: "1px solid #ccc", ... };
const alertError = { ...border: "1px solid #c62828", background: "#ffebee", ... };
const alertSuccess = { ...border: "1px solid #2e7d32", background: "#e8f5e9", ... };

// AFTER — tokenize each
const labelStyle = { ...color: "var(--text-secondary)" };
const selectStyle = { ...border: "1px solid var(--border-input)" };
const inputStyle = { ...border: "1px solid var(--border-input)", ... };
const btnPrimary = { ...background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", ... };
const btnSecondary = { ...background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-input)", ... };
const btnSm = { ...background: "var(--bg-surface)", border: "1px solid var(--border-input)", ... };
const alertError = { ...border: "1px solid var(--error-border)", background: "var(--error-bg)", ... };
const alertSuccess = { ...border: "1px solid var(--success-border)", background: "var(--success-bg)", ... };
```

Then sweep the rest of the file for inline hex refs:
- Drop-zone `#377e00` → `var(--btn-primary-bg)`.
- Drop-zone idle `#bbb` → `var(--border-input)`.
- `#f2fde8` → `var(--green-light)`.
- `#666` muted → `var(--text-muted)`.
- `#999`, `#555` etc. per table.
- `#c62828` error text → `var(--error-text)`.

### 7. [InboxManager.jsx](../frontend/src/InboxManager.jsx) — **OPEN QUESTION**

Legacy photocard tester at repo root (387 lines, 4 hex refs). Wired via
[components/inbox/InboxManagerWrapper.jsx](../frontend/src/components/inbox/InboxManagerWrapper.jsx)
at the `/inbox-manager` route.

**Ask user before touching:**
- Is this still used, or deprecated in favor of `pages/InboxPage.jsx`?
- Options: (a) tokenize alongside, (b) skip, (c) delete the file and route.

Default recommendation: **tokenize it** (the 4 hex refs are trivial) unless
user confirms it's dead code.

---

## Testing

No test suite for visual output. After each file, run:

```bash
cd c:/Dev/CollectCore/frontend && npm run build
```

Build must pass. Then in browser (user-driven):

- **Light mode**: PhotocardLibraryPage grid + table, open a detail modal,
  edit a card (title/member/version/category), save, delete with confirm,
  prev/next nav. Enter select mode, select multi, open bulk edit side panel,
  apply changes. Open InboxPage, drag-drop an image, pair front/back,
  ingest.
- **Dark mode**: same flows. Verify the modal backgrounds now render as
  `--bg-base` (dark) instead of forcing `#fff`. Verify badge colors stay
  neon — same in both themes is expected.

The blue→green recolor per §3.1 affects:
- PhotocardBulkEdit "Apply to N" button.
- PhotocardDetailModal "Save" button + outline.
- PhotocardGrid select-mode overlay circle (top-right ✓).

---

## Follow-ups (deferred out of this pass)

1. **`commonStyles.js` deletion** (§3.4) — can proceed independently. After
   this pass, InboxPage no longer depends on it anyway (it had its own copies).
2. **Primitive adoption in photocards** — not planned. Bespoke prev/next
   nav, dirty state, image replacement, inbox pairing stay as-is. If a future
   session wants to adopt `<Modal>` for the detail modal, the token work here
   is a strict prerequisite and makes that swap cheaper.
3. **Dark mode polish pass** (CLAUDE.md deferred #1 sub-item) — with this
   tokenization done, the photocard module participates in dark-mode theming
   on the same basis as the 7 other modules.
4. **Admin UI polish** (CLAUDE.md deferred #1 sub-item) — unrelated.

---

## Estimated effort

~1 sitting, 5 files modified (skip Filters; decide InboxManager separately):
- PhotocardLibraryPage — trivial (1 hex).
- PhotocardGrid — straightforward (styles block + badge palette + star).
- PhotocardBulkEdit — medium (inline styles).
- PhotocardDetailModal — straightforward (big styles block, mechanical).
- InboxPage — biggest (57 hex, local shim consts + inline).

Plus ~4 lines added to [app.css](../frontend/src/styles/app.css) for the new
badge + special-star tokens.

Total diff expected ~200–300 line-level changes, zero JSX restructuring.
