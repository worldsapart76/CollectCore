# CollectCore UI Redesign — Branding, Module System & Subtle Styling

## Context
CollectCore is being rebuilt from a photocard-specific app into a multi-module collection tracker. The UI still says "Photocard Tracker" everywhere, uses a flat single-module nav, and has no concept of module switching. This plan introduces the CollectCore brand, a module-aware nav with a dropdown switcher, a module-selection landing page, and subtle styling improvements (green brand accent, alternating row shading). Module enable/disable is stored in a new backend settings table.

---

## Design Decisions (confirmed)

- **Module tiles on home** → click goes directly to module library (no sub-landing)
- **Module switcher** → dropdown on brand: `[CC] CollectCore / Photocards ▾`
- **Logo** → CSS badge mark: green square with "CC" in white, followed by "CollectCore" bold text
- **Module settings storage** → backend SQLite settings table (`tbl_app_settings`)

---

## Phase 1: Backend — Settings Table + API

### Schema (`backend/sql/schema.sql`)
Add at the end of the file:
```sql
CREATE TABLE IF NOT EXISTS tbl_app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO tbl_app_settings (key, value)
VALUES ('modules_enabled', '["photocards","books"]');
```

### Endpoints (`backend/main.py`)
Add two endpoints in a "Settings" section:

```
GET  /settings          → returns { key: value, ... } for all rows
PUT  /settings/{key}    → body: { "value": "..." }, upserts row, returns updated row
```

The `modules_enabled` value is a JSON array string (e.g. `'["photocards","books"]'`). The frontend parses it.

---

## Phase 2: Frontend — Module Definitions (static config)

Create `frontend/src/modules.js` — a single static file that defines all known modules. This is the only place module metadata lives.

```js
export const MODULE_DEFS = {
  photocards: {
    id: 'photocards',
    label: 'Photocards',
    primaryPath: '/library',
    description: 'Track your photocard collection',
    links: [
      { label: 'Inbox',   to: '/inbox' },
      { label: 'Library', to: '/library' },
      { label: 'Export',  to: '/export' },
    ],
  },
  books: {
    id: 'books',
    label: 'Books',
    primaryPath: '/books/library',
    description: 'Track your book collection',
    links: [
      { label: 'Add Book', to: '/books/add' },
      { label: 'Library',  to: '/books/library' },
    ],
  },
};

// Derive active module from current pathname
export function getActiveModuleId(pathname) {
  if (pathname.startsWith('/books')) return 'books';
  if (['/inbox', '/library', '/export'].some(p => pathname.startsWith(p))) return 'photocards';
  return null;
}
```

---

## Phase 3: TopNav — Rebrand + Module Dropdown

**File:** `frontend/src/components/layout/TopNav.jsx`

### Changes:
1. **Logo mark** — Replace "Photocard Tracker" text with:
   - A small CSS badge: green square (`#2e7d32` bg, white "CC" text, ~22px, border-radius 4px)
   - Followed by bold "CollectCore" text
   - Clicking the logo navigates to `/`

2. **Module context** — Use `useLocation()` to derive active module via `getActiveModuleId()`.

3. **Dropdown** — When an active module exists, show `ModuleName ▾` next to the logo. Clicking opens a dropdown listing all enabled modules. Selecting a module navigates to its `primaryPath`. Close on outside click or selection.

4. **Nav links** — Replace the hardcoded mixed link list with the active module's `links` array (from `MODULE_DEFS`). If no module is active (home, admin), show no module links.

5. **Admin link** — Keep on right side. Remove the divider pipe hack.

6. **Active state color** — Change `.topnav-link.active` background from `#f0f0f0` to `#e8f5e9` (light green). Update in `app.css`.

### Dropdown state:
- Local `useState` in TopNav
- `useEffect` with document click listener to close on outside click
- Enabled modules list fetched directly in TopNav on mount

---

## Phase 4: HomePage — Module Tiles from API

**File:** `frontend/src/pages/HomePage.jsx`

### Changes:
- On mount, `GET /settings` to get `modules_enabled` list
- Parse the JSON array, map to `MODULE_DEFS` entries
- Render one `HomeTile` per enabled module
- Each tile links directly to `module.primaryPath`
- Remove the hardcoded Inbox/Library/Export tiles

---

## Phase 5: AdminPage — Module Toggle UI

**File:** `frontend/src/pages/AdminPage.jsx`

Replace the placeholder with a real settings section:
- Fetch current `modules_enabled` from `GET /settings`
- Show checkboxes/toggles for each module in `MODULE_DEFS`
- On toggle, `PUT /settings/modules_enabled` with updated JSON array

---

## Phase 6: api.js — Settings API Functions

**File:** `frontend/src/api.js`

Add:
```js
export async function fetchSettings() { ... }
export async function updateSetting(key, value) { ... }
```

---

## Phase 7: Subtle Styling

**File:** `frontend/src/styles/app.css`

1. **Brand badge** — `.brand-badge`: `background: #2e7d32; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 5px; border-radius: 4px; letter-spacing: 0.5px;`
2. **Active nav color** — `.topnav-link.active` bg: `#e8f5e9` (light green)
3. **Alternating row shading** — subtle `#f7f7f7` on even rows in books table view
4. **Module dropdown** — `.module-dropdown` styles: absolute, white bg, `1px solid #ddd`, box-shadow, z-index

---

## Out of Scope (Deferred)
- Photocard sidebar style update (backlog item #17 — color/style changes covered below, layout/spacing still deferred)
- Adding new module definitions (movies, music, etc.)

---

## Phase 8: Styling Refresh — Green Brand + Dark Mode

### User decisions
- All primary buttons and active states shift from blue (`#1565c0`) to brand green
- Dark mode: yes — implement alongside light mode improvements
- Inspiration: green sidebar treatment, card/tile depth (shadows), color-coded badges, typography hierarchy

---

### Phase 8a: CSS Variables + Dark Mode Foundation

**File:** `frontend/src/styles/app.css`

Add CSS custom properties at the top. All class-based color references replaced with vars.
Add `[data-theme="dark"]` block that overrides them.

**Light vars (`:root`):**
- `--bg-base: #ffffff`
- `--bg-surface: #fafafa`
- `--bg-sidebar: #f4f7f4` — barely-there green tint
- `--border: #ddd`, `--border-input: #ccc`
- `--text-primary: #111`, `--text-secondary: #444`, `--text-muted: #666`, `--text-label: #888`
- `--green: #2e7d32`, `--green-light: #e8f5e9`
- `--btn-primary-bg: #2e7d32`, `--btn-primary-text: #fff`
- `--btn-secondary-bg: #f5f5f5`, `--btn-secondary-text: #333`, `--btn-secondary-border: #ccc`
- `--selection-border: #388e3c`
- `--error-text: #9b1c1c`, `--error-bg: #ffebee`, `--error-border: #c62828`

**Dark overrides (`[data-theme="dark"]`):**
- `--bg-base: #141414`, `--bg-surface: #1e1e1e`, `--bg-sidebar: #191f19`
- `--border: #2e2e2e`, `--border-input: #3a3a3a`
- `--text-primary: #e8e8e8`, `--text-secondary: #999`, `--text-muted: #777`, `--text-label: #666`
- `--green: #4caf50`, `--green-light: rgba(76, 175, 80, 0.15)`
- `--btn-primary-bg: #388e3c`, `--btn-secondary-bg: #2a2a2a`, `--btn-secondary-text: #ccc`, `--btn-secondary-border: #3a3a3a`
- `--selection-border: #4caf50`
- `--error-text: #ef9a9a`, `--error-bg: rgba(198, 40, 40, 0.15)`, `--error-border: #7f1d1d`

Also add `.btn-primary` and `.btn-secondary` CSS classes so JSX can migrate off inline styles incrementally.

**File:** `frontend/src/index.css`

Remove conflicting Vite template defaults:
- `:root` dark background and white text color
- Button `padding: 0.6em 1.2em` (too large for compact UI)
- `a { color: #646cff }` → replace with green
- The `prefers-color-scheme` media block (replaced by manual `[data-theme]` toggle)

---

### Phase 8b: Theme Toggle Mechanism

**File:** `frontend/src/components/layout/AppShell.jsx`

- Read `localStorage.getItem('cc-theme')` on mount
- Apply `document.documentElement.setAttribute('data-theme', theme)` on mount and on change
- Pass `theme` + `toggleTheme` down to `TopNav` as props

**File:** `frontend/src/components/layout/TopNav.jsx`

- Accept `theme` / `toggleTheme` props
- Add a small toggle button on the right side: ☀ (light) / ☾ (dark) — no icon library, plain text/emoji

---

### Phase 8c: Blue → Green Button Shift

**File:** `frontend/src/pages/BooksLibraryPage.jsx`
- `btnPrimary.background` `#1976d2` → `var(--btn-primary-bg)`
- `btnSecondary` → `var(--btn-secondary-*)` vars
- All border and text color refs → vars

**File:** `frontend/src/pages/PhotocardLibraryPage.jsx`
- `primaryBtn.background` `#1565c0` → `var(--btn-primary-bg)`
- `toggleBtnActive` background → `var(--btn-primary-bg)`
- Controls bar background → `var(--bg-surface)`, border → `var(--border)`

**File:** `frontend/src/components/photocard/PhotocardFilters.jsx`
- `clearBtn.color` `#1565c0` → `var(--green)` (green, not blue)
- Sidebar background → `var(--bg-sidebar)`
- Section label color → `var(--text-label)`, already uppercase — standardizes with books sidebar
- Text and border colors → vars

---

### Phase 8d: Green Sidebar Treatment

Both library sidebars get `background: var(--bg-sidebar)`:
- Light: `#f4f7f4` (barely perceptible green tint vs. white main area)
- Dark: `#191f19` (slight green tint on dark surface)

Filter section title style standardized across both sidebars:
- `font-size: 11px, font-weight: bold, text-transform: uppercase, letter-spacing: 0.05em, color: var(--text-label)`

---

### Phase 8e: Card / Tile Depth

**`app.css` updates:**
- `.home-tile`: add `box-shadow: 0 1px 4px rgba(0,0,0,0.08)`; hover: `0 2px 8px rgba(0,0,0,0.12)`
- `.card-item`: add `box-shadow: 0 1px 2px rgba(0,0,0,0.06)`; hover: `0 2px 6px rgba(0,0,0,0.10)`

**File:** `frontend/src/components/library/CardGridItem.jsx`
- Card `background` → `var(--bg-base)`, `border` → `var(--border)`
- Selected border → `var(--selection-border)` (green instead of `#4a67ff` blue)

---

### Phase 8f: Format Badges Dark Mode

**File:** `frontend/src/pages/BooksLibraryPage.jsx`

`FORMAT_COLORS` is currently hardcoded. Convert to a function that returns dark-aware values:

```js
function getFormatColors(format, isDark) {
  if (isDark) return {
    Physical: { background: "#2a2a2a", color: "#aaa",    border: "1px solid #444" },
    Digital:  { background: "#0d2137", color: "#64b5f6", border: "1px solid #1565c0" },
    Audio:    { background: "#0d1f0d", color: "#66bb6a", border: "1px solid #2e7d32" },
  }[format];
  return FORMAT_COLORS[format]; // existing light values
}
```

Pass `isDark` from theme state (component reads `document.documentElement.dataset.theme === 'dark'` or receives as prop).

---

### Phase 8g: Typography Hierarchy Standardization

**`app.css` updates:**
- Ensure `.filter-section-title` matches the books sidebar label style: `11px, uppercase, var(--text-label), letter-spacing 0.05em`
- `.home-tile-description`, `.card-caption` → `color: var(--text-secondary)`
- `.topnav-brand` → `color: var(--text-primary)`
- `.library-sidebar-title` → `color: var(--text-primary)`

---

### Critical Files (Phase 8)

| File | Change |
|---|---|
| `frontend/src/styles/app.css` | CSS vars, dark block, class color updates, shadows, `.btn-primary`/`.btn-secondary`, typography |
| `frontend/src/index.css` | Remove conflicting Vite defaults |
| `frontend/src/components/layout/AppShell.jsx` | Theme state + localStorage |
| `frontend/src/components/layout/TopNav.jsx` | Theme toggle button |
| `frontend/src/pages/BooksLibraryPage.jsx` | Buttons → vars, sidebar bg, format badge dark mode |
| `frontend/src/pages/PhotocardLibraryPage.jsx` | Buttons → green, controls bar → vars |
| `frontend/src/components/photocard/PhotocardFilters.jsx` | Sidebar bg, labels, clear button → green |
| `frontend/src/components/library/CardGridItem.jsx` | Card bg/border/selection → vars |

---

### Verification (Phase 8)

1. Light mode: all primary buttons are green; nav active state is green; sidebars have faint green tint
2. Home tiles have subtle shadow; card items gain shadow on hover
3. Theme toggle (☀/☾) in TopNav switches to dark mode; persists on page refresh
4. Dark mode: near-black base, green accents, sidebars slightly green-tinted, text readable
5. Books format badges (Physical/Digital/Audio) readable in both modes
6. Photocard filter "clear" link is green, not blue
7. All existing functionality unchanged

---

## Critical Files

| File | Change |
|---|---|
| `backend/sql/schema.sql` | Add `tbl_app_settings` + seed insert |
| `backend/main.py` | Add `GET /settings`, `PUT /settings/{key}` |
| `frontend/src/modules.js` | New — static module definitions |
| `frontend/src/api.js` | Add `fetchSettings`, `updateSetting` |
| `frontend/src/styles/app.css` | Badge style, active nav color, dropdown styles |
| `frontend/src/components/layout/TopNav.jsx` | Rebrand + module dropdown |
| `frontend/src/pages/HomePage.jsx` | Module tiles from API |
| `frontend/src/pages/AdminPage.jsx` | Module toggle UI |

---

## Verification

1. Start backend: `uvicorn main:app --reload --port 8001`
2. `GET /settings` returns `{ "modules_enabled": "[\"photocards\",\"books\"]" }`
3. Home page shows two tiles: Photocards and Books
4. TopNav shows `[CC] CollectCore / Photocards ▾` when on `/library`
5. Clicking dropdown shows both modules; selecting Books navigates to `/books/library` with updated nav links
6. Admin page: uncheck Books → home shows only Photocards tile
7. Logo badge is green with white "CC"; nav active state is light green
8. Books library table shows subtle alternating row shading
