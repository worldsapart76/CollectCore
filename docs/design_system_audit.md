# CollectCore — Design System Audit & Primitive API Design

Pre-implementation design pass for deferred item #1 (Design system / CSS
consolidation). No code changes here — this doc defines the token surface and
primitive API so the subsequent migration can proceed against a fixed target.

Scope: tokens + primitive components only. The shared `LibraryShell` /
`FilterPanel` extraction is deliberately out of scope (one module pilot first;
see "Sequencing" at the bottom).

---

## 1. Token Audit

### 1.1 Current state — what already exists

Defined in `frontend/src/styles/app.css` (light + dark) and partially
mirrored in `frontend/src/styles/commonStyles.js`.

| Category | Tokens | Notes |
|---|---|---|
| Surfaces | `--bg-base`, `--bg-surface`, `--bg-sidebar` | Complete; works in dark |
| Borders | `--border`, `--border-input` | Complete |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-label` | Complete |
| Green palette | `--green`, `--green-vivid`, `--green-light` | Complete |
| Buttons | `--btn-primary-*`, `--btn-secondary-*` | Missing danger / ghost variants |
| States | `--selection-border`, `--error-text`, `--error-bg`, `--error-border` | Error only — no success/warn |
| Shadows | `--shadow-card`, `--shadow-card-hover`, `--shadow-tile`, `--shadow-tile-hover` | Complete; dark uses glow effect |

`commonStyles.js` exports JS shims (`btnPrimary`, `inputStyle`, `alertError`,
etc.) that *consume* the CSS tokens, but most pages re-implement these inline
rather than importing the shim. The shim itself contains hardcoded hex
(`#c62828`, `#2e7d32`, `#e65100`, `#fff3e0`) that should be moved into tokens.

### 1.2 Token bypass — hardcoded values found in JSX

**Scale of the problem:** 524 hex colors across 33 JSX files vs. 433 `var(--…)`
usages across 21 files. Inline styles outweigh token usage almost 2:1.

Recurring hardcoded values, ranked by frequency, with target tokens:

| Hardcoded | Used as | Target token (existing or new) |
|---|---|---|
| `#c62828` | Danger / delete button color | **NEW** `--danger-text`, `--danger-bg-strong` |
| `#666`, `#555`, `#444`, `#333` | Body text greys | `--text-secondary` / `--text-muted` |
| `#ccc`, `#ddd`, `#e0e0e0` | Inline borders | `--border` / `--border-input` |
| `#fff` | Modal/panel surfaces | `--bg-base` (breaks dark mode!) |
| `#999`, `#888` | Disabled / placeholder text | `--text-muted` |
| `#ffebee`, `#fef3c7`, `#dcfce7`, `#fee2e2` | Inline alerts | **NEW** `--success-bg`, `--warn-bg` (error already exists) |
| `#166534`, `#9b1c1c`, `#991b1b` | Status text | **NEW** `--success-text` (error already exists) |
| `#1565c0`, `#1d4ed8`, `#2563eb`, `#b91c1c` | Action buttons (Apply, Restore) | **NEW** `--btn-danger-*`; also reconsider blue — does this app even want a blue palette? |
| `#39ff14`, `#ffff00`, `#00ff66`, `#ffd600`, `#ff3b3b`, `#00bfff` | Ownership badge palette (Owned/Wanted/Trade/Borrowed) | **NEW** `--badge-owned`, `--badge-wanted`, `--badge-trade`, `--badge-borrowed` |
| `#f9a825` | Star rating colour | **NEW** `--accent-rating` (or accept as semantic constant in a `BookRating` component) |
| `#000`, `#fff` (in badge code) | Badge bg/text | **NEW** `--badge-bg`, `--badge-text` |

**Critical: `#fff` appears 80+ times as a modal/panel background.** This
breaks dark mode silently — modals will stay white-on-white-text in dark mode
unless we map them to `--bg-base`. This is likely a major reason the current
dark mode "is not usable" per CLAUDE.md.

### 1.3 Missing token categories

Currently no tokens for:

**Spacing scale** — every inline `padding`, `margin`, `gap` uses raw numbers
(`gap: 6`, `padding: "10px 14px"`, etc.). Define a 4px-based scale:

```
--space-0:  0
--space-1:  2px
--space-2:  4px
--space-3:  6px
--space-4:  8px
--space-5: 10px
--space-6: 12px
--space-7: 16px
--space-8: 20px
--space-9: 24px
```

**Font-size scale** — `fontSize: 11/12/13/14/15` appears 433 times. Standardise:

```
--text-xs:   11px   (badges, captions, helper)
--text-sm:   12px   (sub-labels, table cells)
--text-base: 13px   (body, inputs, buttons — current default)
--text-md:   14px   (modal titles, emphasis)
--text-lg:   17px   (page section headings)
--text-xl:   1.1rem (page title — already in app.css as .page-title)
```

Audit confirms 13px is the de-facto base — keep it.

**Border-radius scale** — currently 3 / 4 / 6 / 8 / 10 used arbitrarily:

```
--radius-sm: 3px   (inputs, tight chips)
--radius-md: 4px   (buttons, default)
--radius-lg: 6px   (modals, cards)
--radius-xl: 10px  (tiles, hero cards)
```

**Z-index scale** — modals currently use raw `z-index: 1000` and dropdowns use `200`:

```
--z-dropdown: 200
--z-modal:   1000
--z-toast:   2000
```

**Transitions** — repeated `transition: background 0.15s ease, …`:

```
--transition-fast: 0.1s ease
--transition-base: 0.15s ease
```

**Focus ring** — already in `index.css` global; lift to `--focus-ring: 2px solid var(--green-vivid)` so primitives can reuse the variable directly.

### 1.4 Final proposed token surface

After this pass, the token catalogue grows from ~17 → ~50 tokens. All live in
`app.css` `:root` + `[data-theme="dark"]`. `commonStyles.js` is **deprecated**:
its values are either promoted to CSS classes/tokens or absorbed into the
primitives below.

---

## 2. Primitive API Design

Three tiers, build in order. Each primitive is a small JSX component that
emits a single semantic CSS class (no inline styles inside primitives — that's
the whole point). Class definitions live in `app.css` consuming the tokens above.

### Tier A — Atoms

Smallest reusable units. No state, just styled wrappers around HTML elements.

```jsx
<Button variant="primary|secondary|danger|ghost" size="sm|md" disabled />
<Input  size="sm|md" invalid />     // wraps <input type="text|number|…">
<Select size="sm|md" invalid />     // wraps <select>
<Textarea rows />                   // wraps <textarea>
<Checkbox label />                  // <input type="checkbox"> + label
<Label htmlFor required />          // form label
<Badge tone="owned|wanted|trade|borrowed|format|tag|neutral" />
<RemoveButton onClick />            // ✕ icon button, danger-tone — used 15+ times
```

**Variant rationale:**
- `Button` `ghost` = the topnav-style transparent button (current `module-switcher-btn`).
- `Badge` `tone` covers the ownership palette + format chips + book tags via a single component.
- `RemoveButton` is its own primitive because the `× Remove` red-text button
  pattern appears identically in 15+ places (BookIngest, MusicIngest,
  VideoIngest, BoardgamesIngest, NameList, etc.).

### Tier B — Composites

Bundle atoms into common patterns.

```jsx
<FormField label="Title" required helper="…" error="…">
  <Input />
</FormField>

<Modal
  isOpen
  onClose
  title="Edit Book"
  size="sm|md|lg"          // 420 / 700 / 1000 px (current widths in use)
  footer={<>…buttons…</>}
>
  …body…
</Modal>

<ConfirmButton
  label="Delete"
  confirmLabel="Yes, delete"
  danger
  onConfirm={…}
/>                          // collapses the "Delete? / Yes / No" inline trio

<Alert tone="error|success|warn|info">…</Alert>

<Toast tone="ok|error" message="Saved" onDismiss={…} />

<Card>…</Card>              // generic surface with --shadow-card

<CoverThumb src size="sm|md|lg" />   // image with border + radius — 5+ inline copies today
```

**Modal coverage:** the current Modal pattern is hardcoded at least 6 times
(BoardgamesLibraryPage, VideoLibraryPage, BooksLibraryPage,
GraphicNovelsLibraryPage, MusicLibraryPage, AdminPage Toast/Confirm,
CardDetailModal, PhotocardDetailModal). All use the same overlay + centred
panel + header/body/footer structure with the same widths — `Modal` consolidates
~600 LOC across the codebase.

**ConfirmButton coverage:** the "× Delete? → Yes / No" inline state machine
appears identically inside every per-module BulkEditPanel and detail-modal
delete flow. Pulling this into one primitive removes ~30 LOC × 6+ sites.

### Tier C — Layout helpers

Replace one-off flex/grid inline styles with semantic wrappers.

```jsx
<PageContainer>…</PageContainer>          // replaces inline page padding
<Stack gap="3" align="start">…</Stack>    // flex column, gap from --space-N
<Row gap="3" align="center" justify="between">…</Row>  // flex row
<Grid cols={2} gap="3">…</Grid>           // CSS grid with token gap
```

These map flex/grid patterns to spacing tokens, eliminating most leftover
inline `display: flex, gap: 6, …` clumps.

### Tier D — Out of scope (for the migration *after* this one)

These need the atoms/composites first, then a per-module pilot to surface
edge cases before extraction:

- `<LibraryShell sidebar controls content pagination />`
- `<FilterPanel sections />` and `<FilterCheckboxList />`
- `<ViewModeToggle />`, `<GridSizeToggle />`
- `<DataTable columns rows />`

---

## 3. Decisions (confirmed 2026-04-23)

All recommendations below are accepted and locked in for Phase 1+.

1. **Blue accents recoloured to green.** `#1565c0`, `#1d4ed8`, `#2563eb` in
   AdminPage (Apply buttons, progress-bar fills) move onto the green palette.
   No blue accent token added — the app is green-only.

2. **Danger button collapses to two flavours:**
   - `<Button variant="danger">` — solid red background (replaces
     `#b91c1c` / `#c62828` solid variants).
   - `<RemoveButton>` — text-only ✕ icon in danger tone (replaces all
     `color: #c62828` text buttons and `× Remove` patterns).
   The bordered-red variant (`border: #c62828, color: #c62828`) is dropped.

3. **Ownership badge palette kept as-is.** Neon colours
   (`#39ff14, #ffff00, #ff3b3b, #00bfff, #ffd600, #00ff66`) lift into tokens
   (`--badge-owned`, `--badge-wanted`, `--badge-trade`, `--badge-borrowed`)
   unchanged — the high saturation is intentional UX signal.

4. **`commonStyles.js` will be deleted** once primitives land. Migration
   order: new primitives consume tokens directly → pages migrate off
   `commonStyles.js` imports → file removed at end of Phase 6 sweep. No
   parallel-layer period longer than necessary.

5. **Primitive CSS split into its own file.** New file
   `frontend/src/styles/primitives.css` holds primitive classes (Button,
   Input, Modal, Alert, etc.). `app.css` retains layout/shell/page-level
   classes. Both imported from `main.jsx`. No build-tool change.

---

## 4. Sequencing

Once decisions above land:

1. **Phase 1 — Tokens (1 sitting, non-breaking):** Add the new CSS variables
   to `app.css` for both themes. Existing inline styles continue to work; new
   primitives can consume them.

2. **Phase 2 — Atoms (1–2 sittings):** Build `Button`, `Input`, `Select`,
   `Textarea`, `Checkbox`, `Label`, `Badge`, `RemoveButton` with their CSS
   classes. No migration yet — primitives just exist alongside.

3. **Phase 3 — Composites (1–2 sittings):** `FormField`, `Modal`,
   `ConfirmButton`, `Alert`, `Toast`, `Card`, `CoverThumb`. Same — no
   migration yet.

4. **Phase 4 — Layout helpers (1 sitting):** `PageContainer`, `Stack`, `Row`,
   `Grid`. Now we have the full primitive set.

5. **Phase 5 — Pilot migration (1–2 sittings):** Pick one module
   (recommend **TTRPG** or **Board Games** — smallest at 16–43K). Rewrite its
   library + ingest pages purely using the primitives. Watch for
   primitive-API gaps; iterate.

6. **Phase 6 — Sweep (per-module sittings):** Migrate the remaining 7
   modules one at a time. Each module gets its own commit so regressions are
   scoped.

7. **Phase 7 — `LibraryShell` extraction (later):** After all modules are on
   the primitives, the duplicate library/grid/sidebar patterns become
   tractable to extract. Doing this *before* the migration risks a wrong
   abstraction (see CLAUDE.md "premature abstraction" risk).

8. **Phase 8 — Dark mode + admin polish revisit (later):** Both deferred
   sub-items become viable after primitives land, since the `#fff`
   modal-background bug and the AdminPage inline-style sprawl will be gone.

Token audit + primitive API design (this doc) is the deliverable for the
current pass. Implementation begins at Phase 1 in the next session.
