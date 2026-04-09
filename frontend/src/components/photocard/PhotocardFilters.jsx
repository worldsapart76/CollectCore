/**
 * PhotocardFilters — left sidebar filter panel for the photocard library.
 *
 * Props:
 *   groups          — array of { group_id, group_name }
 *   members         — array of { member_id, member_name } (all members, unfiltered)
 *   categories      — array of { top_level_category_id, category_name }
 *   sourceOrigins   — array of { source_origin_id, source_origin_name }
 *   ownershipStatuses — array of { ownership_status_id, status_name }
 *   filters         — current filter state object
 *   onFilterChange  — callback(filterKey, value)
 *   onClearAll      — callback to reset all filters
 */
export default function PhotocardFilters({
  groups,
  members,
  categories,
  sourceOrigins,
  ownershipStatuses,
  filters,
  onFilterChange,
  onClearAll,
}) {
  function toggleMulti(key, value) {
    const current = filters[key] || [];
    const strVal = String(value);
    const next = current.includes(strVal)
      ? current.filter((v) => v !== strVal)
      : [...current, strVal];
    onFilterChange(key, next);
  }

  const hasActiveFilters =
    filters.groupIds?.length > 0 ||
    filters.memberIds?.length > 0 ||
    filters.categoryIds?.length > 0 ||
    filters.sourceOriginIds?.length > 0 ||
    filters.ownershipStatusIds?.length > 0 ||
    filters.backStatus !== "all" ||
    filters.notesSearch?.trim();

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <span style={styles.headerLabel}>Filters</span>
        {hasActiveFilters && (
          <button style={styles.clearBtn} onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      {/* Notes search */}
      <FilterSection label="Search">
        <input
          type="text"
          value={filters.notesSearch || ""}
          onChange={(e) => onFilterChange("notesSearch", e.target.value)}
          placeholder="Search notes..."
          style={styles.textInput}
        />
      </FilterSection>

      {/* Group */}
      <FilterSection label="Group">
        {groups.map((g) => (
          <CheckItem
            key={g.group_id}
            label={g.group_name}
            checked={(filters.groupIds || []).includes(String(g.group_id))}
            onChange={() => toggleMulti("groupIds", g.group_id)}
          />
        ))}
      </FilterSection>

      {/* Member */}
      <FilterSection label="Member">
        {members.map((m) => (
          <CheckItem
            key={m.member_id}
            label={m.member_name}
            checked={(filters.memberIds || []).includes(String(m.member_id))}
            onChange={() => toggleMulti("memberIds", m.member_id)}
          />
        ))}
      </FilterSection>

      {/* Category */}
      <FilterSection label="Category">
        {categories.map((c) => (
          <CheckItem
            key={c.top_level_category_id}
            label={c.category_name}
            checked={(filters.categoryIds || []).includes(String(c.top_level_category_id))}
            onChange={() => toggleMulti("categoryIds", c.top_level_category_id)}
          />
        ))}
      </FilterSection>

      {/* Source Origin */}
      {sourceOrigins.length > 0 && (
        <FilterSection label="Source Origin">
          {sourceOrigins.map((o) => (
            <CheckItem
              key={o.source_origin_id}
              label={o.source_origin_name}
              checked={(filters.sourceOriginIds || []).includes(String(o.source_origin_id))}
              onChange={() => toggleMulti("sourceOriginIds", o.source_origin_id)}
            />
          ))}
        </FilterSection>
      )}

      {/* Ownership */}
      <FilterSection label="Ownership">
        {ownershipStatuses.map((s) => (
          <CheckItem
            key={s.ownership_status_id}
            label={s.status_name}
            checked={(filters.ownershipStatusIds || []).includes(String(s.ownership_status_id))}
            onChange={() => toggleMulti("ownershipStatusIds", s.ownership_status_id)}
          />
        ))}
      </FilterSection>

      {/* Back status */}
      <FilterSection label="Back Image">
        {[
          { value: "all", label: "All" },
          { value: "has_back", label: "Has Back" },
          { value: "missing_back", label: "Missing Back" },
        ].map((opt) => (
          <label key={opt.value} style={styles.radioRow}>
            <input
              type="radio"
              name="backStatus"
              value={opt.value}
              checked={(filters.backStatus || "all") === opt.value}
              onChange={() => onFilterChange("backStatus", opt.value)}
              style={{ marginRight: 6 }}
            />
            {opt.label}
          </label>
        ))}
      </FilterSection>
    </div>
  );
}

function FilterSection({ label, children }) {
  const childArray = Array.isArray(children) ? children : children ? [children] : [];
  const hasOverflow = childArray.length > 5;
  return (
    <div style={styles.section}>
      <div style={styles.sectionLabel}>{label}</div>
      {hasOverflow ? (
        <div style={styles.sectionOverflow}>
          {childArray}
        </div>
      ) : (
        childArray
      )}
    </div>
  );
}

function CheckItem({ label, checked, onChange }) {
  return (
    <label style={styles.checkRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ marginRight: 6, flexShrink: 0 }}
      />
      <span style={styles.checkLabel}>{label}</span>
    </label>
  );
}

const styles = {
  sidebar: {
    width: 200,
    flexShrink: 0,
    borderRight: "1px solid #ddd",
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 0,
    fontSize: 13,
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid #ddd",
  },
  headerLabel: {
    fontWeight: "bold",
    fontSize: 14,
  },
  clearBtn: {
    background: "none",
    border: "none",
    color: "#1565c0",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
  },
  section: {
    marginBottom: 14,
  },
  sectionLabel: {
    fontWeight: "bold",
    marginBottom: 5,
    color: "#555",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: "2px 0",
  },
  checkLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  radioRow: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: "2px 0",
  },
  textInput: {
    width: "100%",
    padding: "4px 6px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 3,
    boxSizing: "border-box",
  },
  sectionOverflow: {
    maxHeight: 110,
    overflowY: "auto",
  },
};
