/**
 * Shared filter sidebar primitives for CollectCore library pages.
 *
 * Exports — state helpers:
 *   emptySection()           → { mode: "or", include: [], exclude: [] }
 *   cycleItem(section, id)   → none → include → exclude → none
 *   getItemState(section, id) → "include" | "exclude" | "none"
 *   sectionActive(section)   → boolean
 *   applySection(section, itemValues) → boolean (filter predicate)
 *
 * Exports — UI components:
 *   FilterSidebarShell         outer wrapper with header + optional search
 *   TriStateFilterSection      list of items with +/- cycling, show-more
 *   SearchableTriStateSection  searchable list with selected chips
 *   GroupedTriStateSection     items nested under group headings
 */
import { useMemo, useState } from "react";

// ─── State helpers ────────────────────────────────────────────────────────────

export function emptySection() {
  return { mode: "or", include: [], exclude: [] };
}

export function cycleItem(section, id) {
  const sid = String(id);
  if (section.include.includes(sid)) {
    return {
      ...section,
      include: section.include.filter((x) => x !== sid),
      exclude: [...section.exclude, sid],
    };
  }
  if (section.exclude.includes(sid)) {
    return { ...section, exclude: section.exclude.filter((x) => x !== sid) };
  }
  return { ...section, include: [...section.include, sid] };
}

export function getItemState(section, id) {
  const sid = String(id);
  if (section.include.includes(sid)) return "include";
  if (section.exclude.includes(sid)) return "exclude";
  return "none";
}

export function sectionActive(s) {
  return s.include.length > 0 || s.exclude.length > 0;
}

/**
 * Returns true if the item (represented by itemValues, an array of strings)
 * passes the filter section. OR mode: any include match is enough. AND mode:
 * all includes must match. Excludes always reject.
 */
export function applySection(section, itemValues) {
  const { mode, include, exclude } = section;
  if (include.length === 0 && exclude.length === 0) return true;
  const vals = itemValues.map(String);
  if (exclude.length > 0 && vals.some((v) => exclude.includes(v))) return false;
  if (include.length === 0) return true;
  if (mode === "or") return vals.some((v) => include.includes(v));
  return include.every((v) => vals.includes(v)); // AND
}

// ─── Shared micro-styles ──────────────────────────────────────────────────────

const inputStyle = {
  fontSize: 12,
  padding: "3px 6px",
  borderRadius: 3,
  border: "1px solid var(--border-input)",
  width: "100%",
  boxSizing: "border-box",
};

const btnSm = {
  fontSize: 11,
  padding: "2px 7px",
  background: "var(--btn-secondary-bg)",
  border: "1px solid var(--btn-secondary-border)",
  borderRadius: 3,
  cursor: "pointer",
};

// ─── Internal sub-components ──────────────────────────────────────────────────

function AndOrToggle({ mode, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {["or", "and"].map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            fontSize: 9,
            padding: "1px 4px",
            cursor: "pointer",
            borderRadius: 2,
            fontWeight: "bold",
            textTransform: "uppercase",
            background: mode === m ? "var(--btn-primary-bg)" : "var(--bg-base)",
            color: mode === m ? "var(--btn-primary-text)" : "var(--text-muted)",
            border: `1px solid ${mode === m ? "var(--btn-primary-bg)" : "var(--border-input)"}`,
          }}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ title, section, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: "var(--text-label)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </div>
      {sectionActive(section) && (
        <AndOrToggle
          mode={section.mode}
          onChange={(m) => onChange({ ...section, mode: m })}
        />
      )}
    </div>
  );
}

function TriStateItem({ label, state, onClick }) {
  const isInclude = state === "include";
  const isExclude = state === "exclude";
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        cursor: "pointer",
        userSelect: "none",
        padding: "1px 3px",
        borderRadius: 3,
        background: isInclude
          ? "var(--green-light)"
          : isExclude
          ? "var(--error-bg)"
          : "transparent",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isInclude
            ? "var(--green-vivid)"
            : isExclude
            ? "#ef5350"
            : "var(--border-input)",
          color: "#fff",
          fontSize: 10,
          fontWeight: "bold",
          lineHeight: 1,
        }}
      >
        {isInclude ? "+" : isExclude ? "−" : ""}
      </div>
      <span
        style={{
          color: isInclude
            ? "var(--green)"
            : isExclude
            ? "var(--error-text)"
            : "var(--text-primary)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Exported filter section components ──────────────────────────────────────

/**
 * A list of items with tri-state click cycling (+/−/none).
 * Shows first 5 by default; show-more button when list is longer.
 *
 * Props:
 *   title   — section header string
 *   items   — array of { id, label }
 *   section — emptySection() value
 *   onChange — callback(newSection)
 */
export function TriStateFilterSection({ title, items, section, onChange, defaultShown = 5 }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, defaultShown);
  const hasMore = items.length > defaultShown;
  return (
    <div style={{ marginBottom: 12 }}>
      <SectionHeader title={title} section={section} onChange={onChange} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {shown.map((item) => (
          <TriStateItem
            key={item.id}
            label={item.label}
            state={getItemState(section, item.id)}
            onClick={() => onChange(cycleItem(section, item.id))}
          />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          style={{ ...btnSm, marginTop: 4 }}
        >
          {expanded ? "Show less" : `+${items.length - defaultShown} more`}
        </button>
      )}
    </div>
  );
}

/**
 * Like TriStateFilterSection but with a search input.
 * Selected items (include/exclude) float to the top as chips.
 * Search filters the unselected items below.
 *
 * Props: same as TriStateFilterSection, plus:
 *   selectedOnly — when true, hides the unselected list until the user types a search
 */
export function SearchableTriStateSection({ title, items, section, onChange, selectedOnly = false }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const selectedItems = items.filter((i) => getItemState(section, i.id) !== "none");

  const unselectedFiltered = useMemo(() => {
    const unselected = items.filter((i) => getItemState(section, i.id) === "none");
    if (!search.trim()) return selectedOnly ? [] : unselected;
    const q = search.toLowerCase();
    const matched = unselected.filter((i) => i.label.toLowerCase().includes(q));
    // Sort: exact match first, then starts-with, then contains
    matched.sort((a, b) => {
      const al = a.label.toLowerCase();
      const bl = b.label.toLowerCase();
      const aExact = al === q ? 0 : al.startsWith(q) ? 1 : 2;
      const bExact = bl === q ? 0 : bl.startsWith(q) ? 1 : 2;
      return aExact - bExact;
    });
    return matched;
  }, [items, section, search, selectedOnly]);

  const SELECTED_ONLY_DEFAULT = 8;
  const shown = selectedOnly
    ? expanded ? unselectedFiltered : unselectedFiltered.slice(0, SELECTED_ONLY_DEFAULT)
    : expanded ? unselectedFiltered : unselectedFiltered.slice(0, 5);
  const hasMore = selectedOnly
    ? unselectedFiltered.length > SELECTED_ONLY_DEFAULT
    : unselectedFiltered.length > 5;

  return (
    <div style={{ marginBottom: 12 }}>
      <SectionHeader title={title} section={section} onChange={onChange} />

      {selectedItems.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
          {selectedItems.map((item) => {
            const state = getItemState(section, item.id);
            const isInc = state === "include";
            return (
              <span
                key={item.id}
                onClick={() => onChange(cycleItem(section, item.id))}
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 10,
                  cursor: "pointer",
                  userSelect: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: isInc ? "var(--green-light)" : "var(--error-bg)",
                  border: `1px solid ${isInc ? "var(--border-input)" : "var(--error-border)"}`,
                  color: isInc ? "var(--green)" : "var(--error-text)",
                }}
              >
                <span style={{ fontWeight: "bold" }}>{isInc ? "+" : "−"}</span>
                {item.label}
              </span>
            );
          })}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${title.toLowerCase()}...`}
        style={{ ...inputStyle, marginBottom: 3 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {shown.map((item) => (
          <TriStateItem
            key={item.id}
            label={item.label}
            state="none"
            onClick={() => onChange(cycleItem(section, item.id))}
          />
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          style={{ ...btnSm, marginTop: 4 }}
        >
          {expanded
            ? "Show less"
            : `+${unselectedFiltered.length - (selectedOnly ? SELECTED_ONLY_DEFAULT : 5)} more`}
        </button>
      )}
    </div>
  );
}

/**
 * Like TriStateFilterSection but items are nested under labelled group headings.
 *
 * Props:
 *   title   — section header string
 *   groups  — array of { groupLabel, items: [{ id, label }] }
 *   section — emptySection() value
 *   onChange — callback(newSection)
 */
export function GroupedTriStateSection({ title, groups, section, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const allItems = groups.flatMap((g) =>
    g.items.map((i) => ({ ...i, groupLabel: g.groupLabel }))
  );
  const hasMore = allItems.length > 5;
  const shownItems = expanded ? allItems : allItems.slice(0, 5);

  const shownGroups = {};
  for (const item of shownItems) {
    if (!shownGroups[item.groupLabel]) shownGroups[item.groupLabel] = [];
    shownGroups[item.groupLabel].push(item);
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <SectionHeader title={title} section={section} onChange={onChange} />
      {Object.entries(shownGroups).map(([groupLabel, items]) => (
        <div key={groupLabel}>
          <div
            style={{
              fontSize: 10,
              fontWeight: "700",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginTop: 3,
              marginBottom: 2,
            }}
          >
            {groupLabel}
          </div>
          <div
            style={{ paddingLeft: 6, display: "flex", flexDirection: "column", gap: 2 }}
          >
            {items.map((item) => (
              <TriStateItem
                key={item.id}
                label={item.label}
                state={getItemState(section, item.id)}
                onClick={() => onChange(cycleItem(section, item.id))}
              />
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          style={{ ...btnSm, marginTop: 4 }}
        >
          {expanded ? "Show less" : `+${allItems.length - 5} more`}
        </button>
      )}
    </div>
  );
}

// ─── HierarchicalGenreSection ─────────────────────────────────────────────────

/**
 * Genre filter with top-level genres and subgenres nested beneath when the
 * parent genre is included. A search bar filters genres/subgenres.
 * Both genre and subgenre selections share the same OR/AND mode.
 *
 * Props:
 *   title           — section header string
 *   genreHierarchy  — [{genre_name, sub_genres: [{sub_genre_name}]}]
 *                     (already filtered to only genres/subgenres present in library)
 *   genreSection    — emptySection() for top-level genres
 *   subGenreSection — emptySection() for subgenres
 *   onGenreChange / onSubGenreChange — callbacks
 */
export function HierarchicalGenreSection({
  title,
  genreHierarchy,
  genreSection,
  subGenreSection,
  onGenreChange,
  onSubGenreChange,
}) {
  const [search, setSearch] = useState("");

  const anyActive = sectionActive(genreSection) || sectionActive(subGenreSection);

  // Active genres (include/exclude) always stay visible so their subgenres remain accessible.
  // Unselected genres appear only when their name matches a search term.
  const visibleGenres = useMemo(() => {
    const active = genreHierarchy.filter(
      (g) => getItemState(genreSection, g.genre_name) !== "none"
    );
    if (!search.trim()) return active;
    const q = search.toLowerCase();
    const searchMatches = genreHierarchy.filter(
      (g) =>
        getItemState(genreSection, g.genre_name) === "none" &&
        (g.genre_name.toLowerCase().includes(q) ||
          g.sub_genres?.some((s) => s.sub_genre_name.toLowerCase().includes(q)))
    );
    return [...active, ...searchMatches];
  }, [genreHierarchy, search, genreSection]);

  function handleModeChange(m) {
    onGenreChange({ ...genreSection, mode: m });
    onSubGenreChange({ ...subGenreSection, mode: m });
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: "700",
            color: "var(--text-label)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {title}
        </div>
        {anyActive && (
          <AndOrToggle mode={genreSection.mode} onChange={handleModeChange} />
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search genres..."
        style={{ ...inputStyle, marginBottom: 3 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visibleGenres.map((g) => {
          const genreState = getItemState(genreSection, g.genre_name);
          const isIncluded = genreState === "include";
          const subGenres = g.sub_genres || [];
          return (
            <div key={g.genre_name}>
              <TriStateItem
                label={g.genre_name}
                state={genreState}
                onClick={() => onGenreChange(cycleItem(genreSection, g.genre_name))}
              />
              {isIncluded && subGenres.length > 0 && (
                <div
                  style={{
                    paddingLeft: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    marginTop: 1,
                  }}
                >
                  {subGenres.map((s) => (
                    <TriStateItem
                      key={s.sub_genre_name}
                      label={s.sub_genre_name}
                      state={getItemState(subGenreSection, s.sub_genre_name)}
                      onClick={() =>
                        onSubGenreChange(cycleItem(subGenreSection, s.sub_genre_name))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── HierarchicalFormatSection ────────────────────────────────────────────────

/**
 * Format filter with Physical/Digital/Audio as top-level and sub-formats nested
 * beneath when the top-level is included. All selections go into one section;
 * filter logic in the page handles matching at either level.
 *
 * Props:
 *   title   — section header string
 *   groups  — [{groupLabel, items: [{id, label}]}]
 *             where groupLabel is the top-level format (Physical/Digital/Audio)
 *   section — emptySection()
 *   onChange — callback(newSection)
 */
export function HierarchicalFormatSection({ title, groups, section, onChange }) {
  const [search, setSearch] = useState("");

  // Active top-level formats always stay visible; unselected ones appear only on search.
  const visibleGroups = useMemo(() => {
    const active = groups.filter((g) => getItemState(section, g.groupLabel) !== "none");
    if (!search.trim()) return active;
    const q = search.toLowerCase();
    const searchMatches = groups.filter(
      (g) =>
        getItemState(section, g.groupLabel) === "none" &&
        (g.groupLabel.toLowerCase().includes(q) ||
          g.items.some((i) => i.label.toLowerCase().includes(q)))
    );
    return [...active, ...searchMatches];
  }, [groups, section, search]);

  return (
    <div style={{ marginBottom: 12 }}>
      <SectionHeader title={title} section={section} onChange={onChange} />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search format..."
        style={{ ...inputStyle, marginBottom: 3 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visibleGroups.map((g) => {
          const topState = getItemState(section, g.groupLabel);
          const isTopIncluded = topState === "include";
          return (
            <div key={g.groupLabel}>
              <TriStateItem
                label={g.groupLabel}
                state={topState}
                onClick={() => onChange(cycleItem(section, g.groupLabel))}
              />
              {isTopIncluded && g.items.length > 0 && (
                <div
                  style={{
                    paddingLeft: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    marginTop: 1,
                  }}
                >
                  {g.items.map((item) => (
                    <TriStateItem
                      key={item.id}
                      label={item.label}
                      state={getItemState(section, item.id)}
                      onClick={() => onChange(cycleItem(section, item.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FilterSidebarShell ───────────────────────────────────────────────────────

/**
 * Outer container for a filter sidebar. Renders the sidebar box, "Filters"
 * header with optional Clear button, optional text search input, then children.
 *
 * Props:
 *   hasFilters        — show Clear button when true
 *   onClearAll        — clear-all callback
 *   searchValue       — controlled value for the text search input (omit to hide)
 *   onSearch          — onChange callback for the text search input
 *   searchPlaceholder — placeholder text (default: "Search...")
 *   children          — filter section components
 */
export function FilterSidebarShell({
  hasFilters,
  onClearAll,
  searchValue,
  onSearch,
  searchPlaceholder = "Search...",
  children,
}) {
  return (
    <div
      style={{
        width: 180,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
        padding: "12px 10px",
        background: "var(--bg-sidebar)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: "700",
            color: "var(--text-label)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Filters
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={onClearAll}
            title="Clear all filters"
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              color: "var(--text-muted)",
              padding: "0 2px",
            }}
          >
            ×
          </button>
        )}
      </div>

      {onSearch !== undefined && (
        <div style={{ marginBottom: 12 }}>
          <input
            value={searchValue || ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={inputStyle}
          />
        </div>
      )}

      {children}
    </div>
  );
}
