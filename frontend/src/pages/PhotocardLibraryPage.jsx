import { useEffect, useMemo, useState } from "react";
import {
  listPhotocards,
  fetchPhotocardGroups,
  fetchTopLevelCategories,
  fetchOwnershipStatuses,
} from "../api";
import PhotocardFilters from "../components/photocard/PhotocardFilters";
import PhotocardGrid from "../components/photocard/PhotocardGrid";
import PhotocardDetailModal from "../components/photocard/PhotocardDetailModal";
import PhotocardBulkEdit from "../components/photocard/PhotocardBulkEdit";
import {
  emptySection,
  sectionActive,
  applySection,
} from "../components/library/FilterSidebar";
import { libraryState } from "../photocardPageState";

const COLLECTION_TYPE_ID = 1;

// Stray Kids canonical member order — cards with multiple members sort to bottom
const MEMBER_ORDER = [
  "Bang Chan", "Lee Know", "Changbin", "Hyunjin",
  "Han", "Felix", "Seungmin", "I.N",
];
function memberSortKey(card) {
  const members = card.members || [];
  if (members.length !== 1) return MEMBER_ORDER.length; // multi → bottom
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

export default function PhotocardLibraryPage() {
  // Data
  const [cards, setCards] = useState([]);
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter / view state — initialized from module store for cross-tab persistence
  const [filters, setFilters] = useState(() => libraryState.filters ?? DEFAULT_FILTERS);
  const [sortMode, setSortMode] = useState(libraryState.sortMode);
  const [viewMode, setViewMode] = useState(libraryState.viewMode);
  const [sizeMode, setSizeMode] = useState(libraryState.sizeMode);
  const [showCaptions, setShowCaptions] = useState(libraryState.showCaptions);
  const [pageSize, setPageSize] = useState(libraryState.pageSize);

  // Selection / bulk edit
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Detail modal
  const [detailCard, setDetailCard] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);

  // Sync filter/view state back to module store on changes
  useEffect(() => {
    libraryState.filters      = filters;
    libraryState.sortMode     = sortMode;
    libraryState.viewMode     = viewMode;
    libraryState.sizeMode     = sizeMode;
    libraryState.showCaptions = showCaptions;
    libraryState.pageSize     = pageSize;
  }, [filters, sortMode, viewMode, sizeMode, showCaptions, pageSize]);

  // Load all lookup data + cards
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
        const HIDDEN = new Set(["Formerly Owned", "Borrowed"]);
        setOwnershipStatuses(statusData.filter(s => !HIDDEN.has(s.status_name)));
      } catch (err) {
        setError(err.message || "Failed to load library");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  async function reloadCards() {
    try {
      const cardData = await listPhotocards();
      setCards(cardData);
    } catch (err) {
      setError(err.message || "Failed to refresh cards");
    }
  }

  // Member list for filter sidebar — sorted by canonical MEMBER_ORDER
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

  // Version list for filter sidebar — sorted alphabetically
  const filterVersions = useMemo(() => {
    const seen = new Map();
    for (const card of cards) {
      if (card.version && !seen.has(card.version)) {
        seen.set(card.version, { id: card.version, label: card.version });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  // Source origins for filter sidebar — derive from cards
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

  // Apply filters
  const filteredCards = useMemo(() => {
    let result = cards;

    if (sectionActive(filters.group)) {
      result = result.filter((c) =>
        applySection(filters.group, [String(c.group_id)])
      );
    }

    if (sectionActive(filters.member)) {
      // member IDs in this sidebar are member names (derived from card data)
      result = result.filter((c) =>
        applySection(filters.member, c.members || [])
      );
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
        applySection(filters.ownership, (c.copies || []).map((cp) => String(cp.ownership_status_id)))
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
          c.copies?.some((cp) => cp.notes?.toLowerCase().includes(q)) ||
          c.members?.some((m) => m.toLowerCase().includes(q)) ||
          c.source_origin?.toLowerCase().includes(q) ||
          c.version?.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q) ||
          c.group_name?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [cards, filters]);

  // Compute copy count: sum of copies matching active ownership filter
  const copyCount = useMemo(() => {
    if (!sectionActive(filters.ownership)) {
      // No ownership filter — count all copies across filtered cards
      return filteredCards.reduce((sum, c) => sum + (c.copies?.length || 0), 0);
    }
    // Count only copies matching the ownership filter
    return filteredCards.reduce((sum, c) => {
      const matching = (c.copies || []).filter((cp) =>
        applySection(filters.ownership, [String(cp.ownership_status_id)])
      );
      return sum + matching.length;
    }, 0);
  }, [filteredCards, filters]);

  // Apply sort
  const sortedCards = useMemo(() => {
    const result = [...filteredCards];
    switch (sortMode) {
      case "id_desc":
        return result.sort((a, b) => b.item_id - a.item_id);
      case "member":
        return result.sort((a, b) => memberSortKey(a) - memberSortKey(b));
      case "category":
        return result.sort((a, b) =>
          (a.category || "").localeCompare(b.category || "")
        );
      case "group":
        return result.sort((a, b) =>
          (a.group_name || "").localeCompare(b.group_name || "")
        );
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
    setPage(1);
  }

  function handleClearAll() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function handleCardClick(card) {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const id = String(card.item_id);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    } else {
      setDetailCard(card);
    }
  }

  function handleSelectAll() {
    setSelectedIds(new Set(sortedCards.map((c) => String(c.item_id))));
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setShowBulkEdit(false);
  }

  const selectedCards = useMemo(
    () => cards.filter((c) => selectedIds.has(String(c.item_id))),
    [cards, selectedIds]
  );

  if (loading) {
    return <div style={{ padding: 24 }}>Loading library...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "#c62828" }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Controls bar */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsLeft}>
          {/* View mode */}
          <ToggleGroup
            label="View"
            options={[
              { value: "fronts", label: "Fronts" },
              { value: "fronts_backs", label: "Fronts + Backs" },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />

          {/* Size */}
          <ToggleGroup
            label="Size"
            options={[
              { value: "s", label: "S" },
              { value: "m", label: "M" },
              { value: "l", label: "L" },
            ]}
            value={sizeMode}
            onChange={setSizeMode}
          />

          {/* Sort */}
          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Sort</span>
            <select
              value={sortMode}
              onChange={(e) => { setSortMode(e.target.value); setPage(1); }}
              style={styles.controlSelect}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Captions */}
          <label style={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={showCaptions}
              onChange={(e) => setShowCaptions(e.target.checked)}
              style={{ marginRight: 5 }}
            />
            Captions
          </label>

          {/* Per-page */}
          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Per page</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              style={styles.controlSelect}
            >
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={120}>120</option>
              <option value={0}>All</option>
            </select>
          </div>
        </div>

        <div style={styles.controlsRight}>
          <span style={styles.cardCount}>
            {sortedCards.length} cards
            {selectMode && selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
          </span>
          {!selectMode ? (
            <button
              style={styles.controlBtn}
              onClick={() => setSelectMode(true)}
            >
              Select
            </button>
          ) : (
            <>
              <button style={styles.controlBtn} onClick={handleSelectAll}>All ({sortedCards.length})</button>
              <button style={styles.controlBtn} onClick={handleClearSelection}>Clear</button>
              {selectedIds.size > 0 && (
                <button
                  style={{ ...styles.controlBtn, ...styles.primaryBtn }}
                  onClick={() => setShowBulkEdit(true)}
                >
                  Bulk Edit
                </button>
              )}
              <button style={styles.controlBtn} onClick={exitSelectMode}>Done</button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={styles.body}>
        {/* Filter sidebar */}
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

        {/* Grid area */}
        <div style={styles.gridArea}>
          <PhotocardGrid
            cards={sortedCards}
            viewMode={viewMode}
            sizeMode={sizeMode}
            showCaptions={showCaptions}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onCardClick={handleCardClick}
            page={page}
            onPageChange={setPage}
            pageSize={pageSize}
            copyCount={copyCount}
          />
        </div>

        {/* Bulk edit panel (alongside grid) */}
        {showBulkEdit && selectedCards.length > 0 && (
          <div style={styles.bulkEditArea}>
            <PhotocardBulkEdit
              selectedCards={selectedCards}
              categories={categories}
              onClose={() => setShowBulkEdit(false)}
              onSaved={async () => {
                setShowBulkEdit(false);
                exitSelectMode();
                await reloadCards();
              }}
              onDeleted={async () => {
                const deletedIds = new Set(selectedCards.map((c) => String(c.item_id)));
                setCards((prev) => prev.filter((c) => !deletedIds.has(String(c.item_id))));
                setShowBulkEdit(false);
                exitSelectMode();
              }}
            />
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailCard && (
        <PhotocardDetailModal
          card={detailCard}
          allCards={sortedCards}
          groups={groups}
          categories={categories}
          onClose={() => setDetailCard(null)}
          onSaved={reloadCards}
          onDeleted={async (itemId) => {
            setDetailCard(null);
            setCards((prev) => prev.filter((c) => c.item_id !== itemId));
          }}
        />
      )}
    </div>
  );
}

function ToggleGroup({ label, options, value, onChange }) {
  return (
    <div style={styles.controlGroup}>
      <span style={styles.controlLabel}>{label}</span>
      <div style={styles.toggleGroup}>
        {options.map((opt) => (
          <button
            key={opt.value}
            style={{
              ...styles.toggleBtn,
              ...(value === opt.value ? styles.toggleBtnActive : {}),
            }}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontSize: 13,
  },
  controlsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexShrink: 0,
    gap: 8,
    flexWrap: "wrap",
  },
  controlsLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  controlsRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  controlGroup: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  controlLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  controlSelect: {
    fontSize: 13,
    padding: "3px 5px",
    border: "1px solid var(--border-input)",
    borderRadius: 3,
  },
  toggleGroup: {
    display: "flex",
    border: "1px solid var(--border-input)",
    borderRadius: 3,
    overflow: "hidden",
  },
  toggleBtn: {
    padding: "3px 8px",
    fontSize: 12,
    background: "var(--bg-base)",
    border: "none",
    borderRight: "1px solid var(--border-input)",
    cursor: "pointer",
    lineHeight: 1.4,
  },
  toggleBtnActive: {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    cursor: "pointer",
  },
  controlBtn: {
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: 3,
    background: "var(--bg-base)",
  },
  primaryBtn: {
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
    border: "none",
  },
  cardCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: "bold",
    marginRight: 6,
  },
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  gridArea: {
    flex: 1,
    overflowY: "auto",
    padding: 12,
  },
  bulkEditArea: {
    flexShrink: 0,
    overflowY: "auto",
    padding: 12,
  },
};
