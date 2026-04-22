import { useEffect, useMemo, useState } from "react";
import {
  listPhotocards,
  fetchPhotocardGroups,
  fetchTopLevelCategories,
  fetchOwnershipStatuses,
  exportPhotocards,
} from "../api";
import { exportState } from "../photocardPageState";
import PhotocardFilters from "../components/photocard/PhotocardFilters";
import {
  emptySection,
  sectionActive,
  applySection,
} from "../components/library/FilterSidebar";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;

// Stray Kids canonical member order — multi-member cards sort to bottom
const MEMBER_ORDER = [
  "Bang Chan", "Lee Know", "Changbin", "Hyunjin",
  "Han", "Felix", "Seungmin", "I.N",
];
function memberSortKey(card) {
  const members = card.members || [];
  if (members.length !== 1) return MEMBER_ORDER.length;
  const idx = MEMBER_ORDER.indexOf(members[0]);
  return idx === -1 ? MEMBER_ORDER.length - 0.5 : idx;
}

const DEFAULT_FILTERS = {
  notesSearch: "",
  group: emptySection(),
  member: emptySection(),
  category: emptySection(),
  sourceOrigin: emptySection(),
  cardType: emptySection(),
  version: emptySection(),
  ownership: emptySection(),
  backImage: emptySection(),
};

const SORT_OPTIONS = [
  { value: "default", label: "Default" },
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

  const [filters, setFilters] = useState(() => exportState.filters ?? DEFAULT_FILTERS);
  const [sortMode, setSortMode] = useState(exportState.sortMode);
  const [includeCaptions, setIncludeCaptions] = useState(exportState.includeCaptions);
  const [includeBacks, setIncludeBacks] = useState(exportState.includeBacks);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Sync filter/view state back to module store on changes
  useEffect(() => {
    exportState.filters         = filters;
    exportState.sortMode        = sortMode;
    exportState.includeCaptions = includeCaptions;
    exportState.includeBacks    = includeBacks;
  }, [filters, sortMode, includeCaptions, includeBacks]);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setError("");
      try {
        const [cardData, groupData, categoryData, statusData] = await Promise.all([
          listPhotocards(),
          fetchPhotocardGroups(),
          fetchTopLevelCategories(COLLECTION_TYPE_ID),
          fetchOwnershipStatuses(COLLECTION_TYPE_IDS.photocards),
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
    return [...memberMap.values()].sort((a, b) => {
      const ai = MEMBER_ORDER.indexOf(a.member_name);
      const bi = MEMBER_ORDER.indexOf(b.member_name);
      const aIdx = ai === -1 ? MEMBER_ORDER.length : ai;
      const bIdx = bi === -1 ? MEMBER_ORDER.length : bi;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.member_name.localeCompare(b.member_name);
    });
  }, [cards]);

  const filterVersions = useMemo(() => {
    const seen = new Map();
    for (const card of cards) {
      if (card.version && !seen.has(card.version)) {
        seen.set(card.version, { id: card.version, label: card.version });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
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

    if (sectionActive(filters.group)) {
      result = result.filter((c) => applySection(filters.group, [String(c.group_id)]));
    }
    if (sectionActive(filters.member)) {
      result = result.filter((c) => applySection(filters.member, c.members || []));
    }
    if (sectionActive(filters.category)) {
      result = result.filter((c) =>
        applySection(filters.category, [String(c.top_level_category_id)])
      );
    }
    if (sectionActive(filters.sourceOrigin)) {
      result = result.filter((c) =>
        applySection(filters.sourceOrigin, [String(c.source_origin_id)])
      );
    }
    if (sectionActive(filters.cardType)) {
      result = result.filter((c) =>
        applySection(filters.cardType, [c.is_special ? "special" : "regular"])
      );
    }
    if (sectionActive(filters.version)) {
      result = result.filter((c) =>
        applySection(filters.version, [c.version || ""])
      );
    }
    if (sectionActive(filters.ownership)) {
      result = result.filter((c) =>
        applySection(filters.ownership, [String(c.ownership_status_id)])
      );
    }
    if (sectionActive(filters.backImage)) {
      result = result.filter((c) =>
        applySection(filters.backImage, [c.back_image_path ? "has_back" : "no_back"])
      );
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
        return result.sort((a, b) => memberSortKey(a) - memberSortKey(b));
      case "category":
        return result.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
      case "group":
        return result.sort((a, b) => (a.group_name || "").localeCompare(b.group_name || ""));
      case "id_asc":
        return result.sort((a, b) => a.item_id - b.item_id);
      case "default":
      default:
        return result.sort((a, b) => {
          const g = (a.group_name || "").localeCompare(b.group_name || "");
          if (g !== 0) return g;
          const c = (a.category || "").localeCompare(b.category || "");
          if (c !== 0) return c;
          const so = (a.source_origin || "").localeCompare(b.source_origin || "");
          if (so !== 0) return so;
          const ct = (a.is_special ? 1 : 0) - (b.is_special ? 1 : 0);
          if (ct !== 0) return ct;
          const v = (a.version || "").localeCompare(b.version || "");
          if (v !== 0) return v;
          return memberSortKey(a) - memberSortKey(b);
        });
    }
  }, [filteredCards, sortMode]);

  function handleSectionChange(key, value) {
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
          versions={filterVersions}
          ownershipStatuses={ownershipStatuses}
          filters={filters}
          onSectionChange={handleSectionChange}
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
    background: "#377e00",
    color: "#fff",
    border: "1px solid #377e00",
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
