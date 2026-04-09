import { useEffect, useMemo, useState } from "react";
import {
  listPhotocards,
  fetchPhotocardGroups,
  fetchTopLevelCategories,
  fetchOwnershipStatuses,
  exportPhotocards,
} from "../api";
import PhotocardFilters from "../components/photocard/PhotocardFilters";

const COLLECTION_TYPE_ID = 1;

const DEFAULT_FILTERS = {
  notesSearch: "",
  groupIds: [],
  memberIds: [],
  categoryIds: [],
  sourceOriginIds: [],
  ownershipStatusIds: [],
  backStatus: "all",
};

const SORT_OPTIONS = [
  { value: "id_asc", label: "ID ↑" },
  { value: "id_desc", label: "ID ↓" },
  { value: "member", label: "Member" },
  { value: "category", label: "Category" },
  { value: "group", label: "Group" },
];

export default function ExportPage() {
  const [cards, setCards] = useState([]);
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortMode, setSortMode] = useState("id_asc");
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [includeBacks, setIncludeBacks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setError("");
      try {
        const [cardData, groupData, categoryData, statusData] = await Promise.all([
          listPhotocards(),
          fetchPhotocardGroups(),
          fetchTopLevelCategories(COLLECTION_TYPE_ID),
          fetchOwnershipStatuses(),
        ]);
        setCards(cardData);
        setGroups(groupData);
        setCategories(categoryData);
        setOwnershipStatuses(statusData);
      } catch (err) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  const filterMembers = useMemo(() => {
    const memberMap = new Map();
    for (const card of cards) {
      if (card.members) {
        for (const name of card.members) {
          if (!memberMap.has(name)) {
            memberMap.set(name, { member_id: name, member_name: name });
          }
        }
      }
    }
    return [...memberMap.values()].sort((a, b) =>
      a.member_name.localeCompare(b.member_name)
    );
  }, [cards]);

  const filterSourceOrigins = useMemo(() => {
    const soMap = new Map();
    for (const card of cards) {
      if (card.source_origin_id && card.source_origin) {
        if (!soMap.has(card.source_origin_id)) {
          soMap.set(card.source_origin_id, {
            source_origin_id: card.source_origin_id,
            source_origin_name: card.source_origin,
          });
        }
      }
    }
    return [...soMap.values()].sort((a, b) =>
      a.source_origin_name.localeCompare(b.source_origin_name)
    );
  }, [cards]);

  const filteredCards = useMemo(() => {
    let result = cards;

    if (filters.groupIds?.length > 0) {
      result = result.filter((c) => filters.groupIds.includes(String(c.group_id)));
    }
    if (filters.memberIds?.length > 0) {
      result = result.filter((c) =>
        c.members?.some((name) => filters.memberIds.includes(name))
      );
    }
    if (filters.categoryIds?.length > 0) {
      result = result.filter((c) =>
        filters.categoryIds.includes(String(c.top_level_category_id))
      );
    }
    if (filters.sourceOriginIds?.length > 0) {
      result = result.filter((c) =>
        filters.sourceOriginIds.includes(String(c.source_origin_id))
      );
    }
    if (filters.ownershipStatusIds?.length > 0) {
      result = result.filter((c) =>
        filters.ownershipStatusIds.includes(String(c.ownership_status_id))
      );
    }
    if (filters.backStatus === "has_back") {
      result = result.filter((c) => c.back_image_path);
    } else if (filters.backStatus === "missing_back") {
      result = result.filter((c) => !c.back_image_path);
    }
    if (filters.notesSearch?.trim()) {
      const q = filters.notesSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.notes?.toLowerCase().includes(q) ||
          c.members?.some((m) => m.toLowerCase().includes(q)) ||
          c.source_origin?.toLowerCase().includes(q) ||
          c.version?.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q) ||
          c.group_name?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [cards, filters]);

  const sortedCards = useMemo(() => {
    const result = [...filteredCards];
    switch (sortMode) {
      case "id_desc":
        return result.sort((a, b) => b.item_id - a.item_id);
      case "member":
        return result.sort((a, b) =>
          (a.members?.[0] || "").localeCompare(b.members?.[0] || "")
        );
      case "category":
        return result.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
      case "group":
        return result.sort((a, b) => (a.group_name || "").localeCompare(b.group_name || ""));
      case "id_asc":
      default:
        return result.sort((a, b) => a.item_id - b.item_id);
    }
  }, [filteredCards, sortMode]);

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearAll() {
    setFilters(DEFAULT_FILTERS);
  }

  async function handleExport() {
    if (sortedCards.length === 0) return;

    setIsExporting(true);
    setExportError("");

    try {
      const blob = await exportPhotocards({
        itemIds: sortedCards.map((c) => c.item_id),
        includeCaptions,
        includeBacks,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "photocard_export.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setExportError(err.message || "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  const ownershipSections = useMemo(() => {
    return [
      ...new Set(sortedCards.map((c) => c.ownership_status).filter(Boolean)),
    ].sort();
  }, [sortedCards]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (error) return <div style={{ padding: 24, color: "#c62828" }}>Error: {error}</div>;

  return (
    <div style={styles.page}>
      {/* Controls bar */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsLeft}>
          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Sort</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              style={styles.controlSelect}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={includeCaptions}
              onChange={(e) => setIncludeCaptions(e.target.checked)}
              style={{ marginRight: 5 }}
            />
            Include captions
          </label>

          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={includeBacks}
              onChange={(e) => setIncludeBacks(e.target.checked)}
              style={{ marginRight: 5 }}
            />
            Include backs
          </label>
        </div>

        <div style={styles.controlsRight}>
          <button
            style={{
              ...styles.exportBtn,
              ...(sortedCards.length === 0 || isExporting ? styles.exportBtnDisabled : {}),
            }}
            onClick={handleExport}
            disabled={sortedCards.length === 0 || isExporting}
          >
            {isExporting ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        <PhotocardFilters
          groups={groups}
          members={filterMembers}
          categories={categories}
          sourceOrigins={filterSourceOrigins}
          ownershipStatuses={ownershipStatuses}
          filters={filters}
          onFilterChange={handleFilterChange}
          onClearAll={handleClearAll}
        />

        <div style={styles.content}>
          {exportError && (
            <div style={styles.errorBanner}>{exportError}</div>
          )}

          <div style={styles.summaryCard}>
            <div style={styles.summaryTitle}>Export Summary</div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Matching cards</span>
              <span style={styles.summaryValue}>{sortedCards.length}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Ownership</span>
              <span style={styles.summaryValue}>
                {ownershipSections.length > 0 ? ownershipSections.join(", ") : "—"}
              </span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Captions</span>
              <span style={styles.summaryValue}>{includeCaptions ? "Yes" : "No"}</span>
            </div>
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Backs</span>
              <span style={styles.summaryValue}>{includeBacks ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    fontFamily: "sans-serif",
    fontSize: 13,
  },
  controlsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 12px",
    borderBottom: "1px solid #ddd",
    background: "#f5f5f5",
    flexShrink: 0,
    gap: 8,
    flexWrap: "wrap",
  },
  controlsLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  controlsRight: {
    display: "flex",
    alignItems: "center",
  },
  controlGroup: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  controlLabel: {
    fontSize: 11,
    color: "#666",
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  controlSelect: {
    fontSize: 13,
    padding: "3px 5px",
    border: "1px solid #ccc",
    borderRadius: 3,
  },
  checkLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    cursor: "pointer",
  },
  exportBtn: {
    padding: "5px 16px",
    fontSize: 13,
    fontWeight: "bold",
    cursor: "pointer",
    background: "#1565c0",
    color: "#fff",
    border: "1px solid #1565c0",
    borderRadius: 3,
  },
  exportBtnDisabled: {
    background: "#90a4ae",
    borderColor: "#90a4ae",
    cursor: "default",
  },
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    padding: 12,
    gap: 12,
  },
  content: {
    flex: 1,
    overflowY: "auto",
  },
  errorBanner: {
    background: "#ffebee",
    color: "#c62828",
    border: "1px solid #ef9a9a",
    borderRadius: 4,
    padding: "8px 12px",
    marginBottom: 12,
    fontSize: 13,
  },
  summaryCard: {
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "12px 16px",
    background: "#fafafa",
    maxWidth: 400,
  },
  summaryTitle: {
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid #eee",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    fontSize: 13,
  },
  summaryLabel: {
    color: "#666",
  },
  summaryValue: {
    fontWeight: "bold",
    maxWidth: 260,
    textAlign: "right",
  },
};
