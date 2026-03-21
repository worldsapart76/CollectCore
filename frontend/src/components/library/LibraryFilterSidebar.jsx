import { useMemo, useState } from "react";
import FilterSection from "./FilterSection";
import FilterSearchList from "./FilterSearchList";
import { getGroupLabel } from "../../utils/groupUtils";

export default function LibraryFilterSidebar({
  filters,
  availableOptions,
  onSearchChange,
  onToggleMember,
  onToggleGroupCode,
  onToggleTopLevelCategory,
  onToggleSubCategory,
  onVersionChange,
  onToggleBackStatus,
  onToggleOwnershipStatus,
  onClearAll,
}) {
  const [versionQuery, setVersionQuery] = useState("");

  const sectionStyle = {
    padding: "6px 0",
    borderBottom: "1px solid #ddd",
  };

  const labelStyle = {
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: 4,
  };

  const trimmedVersionQuery = versionQuery.trim();

  const matchingVersions = useMemo(() => {
    const query = trimmedVersionQuery.toLowerCase();

    if (!query) {
      return [];
    }

    return (availableOptions.versions || []).filter((version) =>
      version.toLowerCase().includes(query)
    );
  }, [availableOptions.versions, trimmedVersionQuery]);

  return (
    <aside className="library-sidebar" style={{ fontSize: "13px" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Filters</div>

      <div style={sectionStyle}>
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search notes..."
          style={{ width: "100%", padding: "4px" }}
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Member</div>
        <FilterSearchList
          items={availableOptions.members}
          selectedItems={filters.members}
          onToggleItem={onToggleMember}
          searchable={false}
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Group</div>
        <FilterSearchList
          items={availableOptions.groupCodes}
          selectedItems={filters.groupCodes}
          onToggleItem={onToggleGroupCode}
          formatItemLabel={getGroupLabel}
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Category</div>
        <FilterSearchList
          items={availableOptions.topLevelCategories}
          selectedItems={filters.topLevelCategories}
          onToggleItem={onToggleTopLevelCategory}
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Subcategory</div>
        <FilterSearchList
          items={availableOptions.subCategories}
          selectedItems={filters.subCategories}
          onToggleItem={onToggleSubCategory}
          searchable
          searchPlaceholder="Find subcategory..."
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Version</div>

        <input
          type="text"
          value={versionQuery}
          onChange={(e) => setVersionQuery(e.target.value)}
          placeholder="Search versions..."
          style={{ width: "100%", padding: "4px", marginBottom: filters.version || trimmedVersionQuery ? 6 : 0 }}
        />

        {filters.version ? (
          <div style={{ marginBottom: trimmedVersionQuery ? 6 : 0 }}>
            <button
              type="button"
              onClick={() => {
                onVersionChange("");
                setVersionQuery("");
              }}
              style={{ padding: "2px 8px" }}
            >
              Clear Version: {filters.version}
            </button>
          </div>
        ) : null}

        {trimmedVersionQuery ? (
          <div
            style={{
              maxHeight: "140px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {matchingVersions.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#666" }}>No matching versions</div>
            ) : (
              matchingVersions.map((version) => (
                <button
                  key={version}
                  type="button"
                  onClick={() => {
                    onVersionChange(version);
                    setVersionQuery(version);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "3px 6px",
                    background: filters.version === version ? "#88f" : "#eee",
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title={version}
                >
                  {version}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Ownership</div>
        <FilterSearchList
          items={["Owned", "Want", "For Trade"]}
          selectedItems={filters.ownershipStatus || []}
          onToggleItem={onToggleOwnershipStatus}
        />
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Back Status</div>
        <FilterSearchList
          items={["has-back", "missing-back"]}
          selectedItems={filters.backStatus}
          onToggleItem={onToggleBackStatus}
          formatItemLabel={(item) =>
            item === "has-back" ? "Has Back" : "Missing Back"
          }
        />
      </div>

      <div style={{ paddingTop: 6 }}>
        <button
          type="button"
          className="clear-filters-button"
          onClick={onClearAll}
          style={{ padding: "4px 8px" }}
        >
          Clear All
        </button>
      </div>
    </aside>
  );
}