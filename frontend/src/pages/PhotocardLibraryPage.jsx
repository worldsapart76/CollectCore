import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  listPhotocards,
  fetchPhotocardGroups,
  fetchTopLevelCategories,
  fetchOwnershipStatuses,
  exportPhotocardTradesCsv,
  getMarketSummary,
} from "../api";
import { isAdmin } from "../utils/env";
import PhotocardFilters from "../components/photocard/PhotocardFilters";
import PhotocardGrid from "../components/photocard/PhotocardGrid";
import PhotocardDetailModal from "../components/photocard/PhotocardDetailModal";
import PhotocardBulkEdit from "../components/photocard/PhotocardBulkEdit";
import TradeCreateModal from "../components/photocard/TradeCreateModal";
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  TRIAGE_STATUS_CODES,
  applyPhotocardFilters,
  deriveFilterMembers,
  deriveFilterSourceOrigins,
  deriveFilterVersions,
  isCardTracked,
  sortPhotocards,
} from "../components/photocard/photocardFiltering";
import { libraryState, persistMobileCardsPerRow } from "../photocardPageState";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import { usePageActions } from "../contexts/PageActionsContext";

// Non-admin detail + bulk-add modals (the card-copy editors). Lazy + env-gated
// so admin builds eliminate them. Two non-admin tiers resolve to different
// implementations: the /pcs/ build uses the server-backed modals; the legacy
// WASM /guest/ build uses the SQLite-backed ones. Admin builds get null.
// Variable names keep the Guest* prefix to avoid churn at the render sites.
const GuestPhotocardDetailModal = import.meta.env.VITE_IS_ADMIN === "true"
  ? null
  : (import.meta.env.VITE_IS_PCS === "true"
      ? lazy(() => import("../pcs/PcsPhotocardDetailModal"))
      : lazy(() => import("../guest/GuestPhotocardDetailModal")));

const GuestPhotocardBulkAdd = import.meta.env.VITE_IS_ADMIN === "true"
  ? null
  : (import.meta.env.VITE_IS_PCS === "true"
      ? lazy(() => import("../pcs/PcsPhotocardBulkAdd"))
      : lazy(() => import("../guest/GuestPhotocardBulkAdd")));

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;

export default function PhotocardLibraryPage() {
  // Data
  const [rawCards, setCards] = useState([]);
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  // Sparse map of item_id -> market facts, from /market/summary. One payload
  // feeding the $ badge, the Market filter, the caption line and the detail
  // modal, so those four can never disagree about whether a card has data.
  // Empty on guest builds; getMarketSummary() short-circuits there.
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter / view state — initialized from module store for cross-tab persistence
  // Spread over DEFAULT_FILTERS so a session persisted before a new filter
  // section existed still gets a valid (empty) section for it.
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...(libraryState.filters ?? {}),
  }));
  const [sortMode, setSortMode] = useState(libraryState.sortMode);
  const [viewMode, setViewMode] = useState(libraryState.viewMode);
  const [sizeMode, setSizeMode] = useState(libraryState.sizeMode);
  const [showCaptions, setShowCaptions] = useState(libraryState.showCaptions);
  const [pageSize, setPageSize] = useState(libraryState.pageSize);
  const [mobileCardsPerRow, setMobileCardsPerRow] = useState(libraryState.mobileCardsPerRow);

  // Selection / bulk edit / trade
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showTradeCreate, setShowTradeCreate] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Detail modal
  const [detailCard, setDetailCard] = useState(null);

  // Preserve `.app-main` scroll position across modal open/close.
  //
  // iOS Safari resets the inner scroll container to 0 when a position:fixed
  // overlay covers the viewport. The save MUST happen synchronously inside
  // the user-gesture event handler (see handleCardClick) — by the time a
  // useEffect fires after commit/paint, iOS has already zeroed scrollTop
  // and we'd save 0. The restore runs from useLayoutEffect when detailCard
  // clears, plus a delayed rAF retry because iOS sometimes re-zeros after
  // our first set as the overlay tears down.
  const savedScrollRef = useRef(0);
  useLayoutEffect(() => {
    if (detailCard) return;
    const main = document.querySelector(".app-main");
    if (!main) return;
    const y = savedScrollRef.current;
    if (y <= 0) return;
    main.scrollTop = y;
    requestAnimationFrame(() => {
      if (main.scrollTop !== y) main.scrollTop = y;
    });
    // Belt-and-suspenders: a final attempt after iOS has finished its
    // post-overlay layout pass. 60ms is enough that the first two writes
    // have rendered; if iOS still re-zeroed, this catches it.
    const t = setTimeout(() => {
      if (main.scrollTop !== y) main.scrollTop = y;
    }, 60);
    return () => clearTimeout(t);
  }, [detailCard]);

  // Pagination
  const [page, setPage] = useState(1);

  // Sync filter/view state back to module store on changes
  useEffect(() => {
    libraryState.filters           = filters;
    libraryState.sortMode          = sortMode;
    libraryState.viewMode          = viewMode;
    libraryState.sizeMode          = sizeMode;
    libraryState.showCaptions      = showCaptions;
    libraryState.pageSize          = pageSize;
    libraryState.mobileCardsPerRow = mobileCardsPerRow;
    persistMobileCardsPerRow(mobileCardsPerRow);
  }, [filters, sortMode, viewMode, sizeMode, showCaptions, pageSize, mobileCardsPerRow]);

  // Track whether libraryState had filters at first mount. Used to decide
  // whether the guest's "exclude Catalog by default" should fire (we don't
  // want to clobber filters the user already picked in this session).
  const hadStoredFiltersRef = useRef(libraryState.filters != null);

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
          fetchOwnershipStatuses(COLLECTION_TYPE_ID),
        ]);
        setCards(cardData);
        setGroups(groupData);
        setCategories(categoryData);
        setOwnershipStatuses(statusData);
        // Deliberately NOT in the Promise.all above: the library must render
        // with no market data at all rather than block on, or fail because of,
        // an admin-only extra. A dropped summary costs badges, not the page.
        getMarketSummary()
          .then((m) => setMarket(m?.cards || {}))
          .catch(() => setMarket({}));

        // Guest default-filter logic:
        // - First-visit experience (guest has zero real copies): show the full
        //   catalog, no filter applied. User scrolls + adds Wanted/Owned cards.
        // - Subsequent visits (any real copies exist): default to excluding
        //   the synthetic Catalog status so the library shows only what the
        //   guest has claimed. They can re-filter to Catalog to add more.
        // Only sets the default when no per-session filter state was loaded.
        if (!isAdmin && !hadStoredFiltersRef.current) {
          const guestHasRealCopies = cardData.some((c) =>
            (c.copies || []).some((cp) => cp.copy_id != null),
          );
          if (guestHasRealCopies) {
            const catalogStatus = statusData.find((s) => s.status_code === "catalog");
            if (catalogStatus) {
              setFilters((prev) => ({
                ...prev,
                ownership: {
                  mode: "or",
                  include: [],
                  exclude: [String(catalogStatus.ownership_status_id)],
                },
              }));
            }
          }
        }
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

  // Auto-refresh after a guest catalog sync. GuestBootstrap fires
  // syncCatalog() in the background on every page load, and the user
  // can also manually trigger it from the hamburger menu — both paths
  // dispatch `collectcore:guest-catalog-updated` from sqliteService when
  // the worker has finished applying the delta. Listening here lets the
  // library re-fetch in place without the user reloading the page,
  // closing the race where the page mounts and reads stale data before
  // the background sync finishes. Admin builds never dispatch this
  // event, so the listener is a harmless no-op there.
  useEffect(() => {
    const handler = (e) => {
      if (e?.detail?.itemsApplied > 0) reloadCards();
    };
    window.addEventListener("collectcore:guest-catalog-updated", handler);
    return () => window.removeEventListener("collectcore:guest-catalog-updated", handler);
  }, []);

  // Market facts grafted onto the card rows, once, so filtering, the badge,
  // the caption and the detail modal all read `c.market` instead of each
  // reaching into the map with its own lookup.
  const cards = useMemo(() => {
    if (!market) return rawCards;
    return rawCards.map((c) => {
      const m = market[String(c.item_id)];
      return m ? { ...c, market: m } : c;
    });
  }, [rawCards, market]);

  // Member list for filter sidebar — sorted by canonical MEMBER_ORDER
  const filterMembers = useMemo(() => deriveFilterMembers(cards), [cards]);

  // Version list for filter sidebar, scoped to the selected source origin(s)
  const filterVersions = useMemo(
    () => deriveFilterVersions(cards, filters.sourceOrigin),
    [cards, filters.sourceOrigin]
  );

  // Source origins for filter sidebar — derive from cards
  const filterSourceOrigins = useMemo(() => deriveFilterSourceOrigins(cards), [cards]);

  // Triage status ids, resolved by status_code — ids are DB-assigned and differ
  // between environments, so they can never be hardcoded.
  const triageStatusIds = useMemo(
    () =>
      new Set(
        ownershipStatuses
          .filter((s) => TRIAGE_STATUS_CODES.includes(s.status_code))
          .map((s) => s.ownership_status_id)
      ),
    [ownershipStatuses]
  );

  // Admin-only: how many cards carry a real possession fact. Meaningless on
  // /pcs/, where the triage statuses don't exist and every catalog card holds a
  // synthetic Catalog copy — every card would count as tracked.
  const trackedCount = useMemo(() => {
    if (!isAdmin || triageStatusIds.size === 0) return null;
    return cards.filter((c) => isCardTracked(c, triageStatusIds)).length;
  }, [cards, triageStatusIds]);

  // Apply filters
  const filteredCards = useMemo(
    () => applyPhotocardFilters(cards, filters, triageStatusIds),
    [cards, filters, triageStatusIds]
  );

  // Apply sort
  const sortedCards = useMemo(
    () => sortPhotocards(filteredCards, sortMode),
    [filteredCards, sortMode]
  );

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
      // Capture the scroll position synchronously inside the user gesture.
      // useEffect would fire too late: iOS Safari resets `.app-main`'s
      // scrollTop to 0 during/before the overlay's first paint, so by the
      // time a post-commit effect ran we'd be saving 0.
      const main = document.querySelector(".app-main");
      if (main) savedScrollRef.current = main.scrollTop;
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

  // Filter against `sortedCards` (not `cards`) so downstream consumers —
  // notably TradeCreateModal, where order is user-visible — get the user's
  // chosen sort instead of the raw fetch order.
  const selectedCards = useMemo(
    () => sortedCards.filter((c) => selectedIds.has(String(c.item_id))),
    [sortedCards, selectedIds]
  );

  // Export the Mercari trade worksheet for what the user is looking at.
  //
  // The CLIENT decides the scope — the notes search is client-side and covers
  // copy notes, so a server-side "all trade copies" query would be blind to
  // it. Explicit selection wins; with nothing selected we send the whole
  // filtered set, which is what "search `for sale` then export" needs.
  async function handleExportCsv() {
    const source = selectedIds.size > 0 ? selectedCards : sortedCards;
    if (source.length === 0) return;
    setExporting(true);
    try {
      const { rows } = await exportPhotocardTradesCsv(source.map((c) => c.item_id));
      if (rows === 0) {
        window.alert("None of those cards have a Trade copy, so the export is empty.");
      }
    } catch (err) {
      window.alert(err.message || "Failed to export trade CSV");
    } finally {
      setExporting(false);
    }
  }

  // Register Sort + Select as TopNav icon buttons on mobile (page-actions context).
  // Guest mode keeps Select (for bulk-add to wanted/owned via guest_card_copies)
  // but hides Sort — filter is the right primitive at 10K+ scale.
  usePageActions(
    isAdmin
      ? [
          {
            id: "sort",
            iconName: "sort",
            kind: "menu",
            label: "Sort",
            value: sortMode,
            options: SORT_OPTIONS,
            onChange: (v) => { setSortMode(v); setPage(1); },
          },
          {
            id: "select",
            iconName: "select",
            kind: "toggle",
            label: selectMode ? "Done" : "Select",
            active: selectMode,
            onClick: () => {
              if (selectMode) {
                exitSelectMode();
              } else {
                setSelectMode(true);
              }
            },
          },
        ]
      : [
          {
            id: "select",
            iconName: "select",
            kind: "toggle",
            label: selectMode ? "Done" : "Select",
            active: selectMode,
            onClick: () => {
              if (selectMode) {
                exitSelectMode();
              } else {
                setSelectMode(true);
              }
            },
          },
        ],
    [sortMode, selectMode]
  );

  if (loading) {
    return <div style={{ padding: 24 }}>Loading library...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: "var(--error-text)" }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Controls bar */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsLeft}>
          {/* View mode (desktop only — mobile uses detail modal for backs) */}
          <div className="desktop-only" style={{ display: "contents" }}>
            <ToggleGroup
              label="View"
              options={[
                { value: "fronts", label: "Fronts" },
                { value: "fronts_backs", label: "Fronts + Backs" },
              ]}
              value={viewMode}
              onChange={setViewMode}
            />
          </div>

          {/* Size (desktop only) */}
          <div className="desktop-only" style={{ display: "contents" }}>
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
          </div>

          {/* Cards per row (mobile only) */}
          <div className="mobile-only" style={styles.controlGroup}>
            <span style={styles.controlLabel}>Per row</span>
            <div style={styles.toggleGroup}>
              <button
                style={styles.toggleBtn}
                onClick={() => setMobileCardsPerRow((n) => Math.max(2, n - 1))}
                aria-label="Fewer cards per row"
              >
                −
              </button>
              <span style={{ ...styles.toggleBtn, minWidth: 28, textAlign: "center", cursor: "default" }}>
                {mobileCardsPerRow}
              </span>
              <button
                style={styles.toggleBtn}
                onClick={() => setMobileCardsPerRow((n) => Math.min(8, n + 1))}
                aria-label="More cards per row"
              >
                +
              </button>
            </div>
          </div>

          {/* Sort (desktop only — mobile uses TopNav icon). Hidden in guest
              mode per project_guest_ui_simplifications memory. */}
          {isAdmin && (
            <div className="desktop-only" style={styles.controlGroup}>
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
          )}

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

          {/* Per-page (desktop only — mobile uses infinite scroll) */}
          <div className="desktop-only" style={styles.controlGroup}>
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
          {/* Triage progress readout. Desktop only — library management happens
              on PC and the narrow mobile header shouldn't carry extra numbers.
              Keeping the filtered count labelled "cards" (rather than renaming it
              "showing") makes the extra numbers a pure prefix, so the mobile
              string is unchanged and no wording is breakpoint-conditional. */}
          <span style={styles.cardCount}>
            <span className="desktop-only">
              {cards.length} total
              {trackedCount !== null ? ` · ${trackedCount} tracked` : ""}
              {" · "}
            </span>
            {sortedCards.length} cards
            {selectMode && selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
          </span>
          {/* Select / bulk: admin edits catalog rows; guest adds copy rows
              for each selected card via guest_card_copies (no catalog mutation). */}
          {!selectMode && (
            <button
              className="desktop-only"
              style={styles.controlBtn}
              onClick={() => setSelectMode(true)}
            >
              Select
            </button>
          )}
        </div>
      </div>

      {/* Select-mode toolbar — own row so card count stays on the main controls bar */}
      {selectMode && (
        <div style={styles.selectBar}>
          <button style={styles.controlBtn} onClick={handleSelectAll}>All ({sortedCards.length})</button>
          <button style={styles.controlBtn} onClick={handleClearSelection}>Clear</button>
          {selectedIds.size > 0 && (
            <button
              style={{ ...styles.controlBtn, ...styles.primaryBtn }}
              onClick={() => setShowBulkEdit(true)}
            >
              {isAdmin ? "Bulk Edit" : "Bulk Update"}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              style={styles.controlBtn}
              onClick={() => setShowTradeCreate(true)}
            >
              Generate Trade Page
            </button>
          )}
          {/* Mercari worksheet for the trade shelf — selection, or everything
              currently filtered when nothing is explicitly selected. */}
          {isAdmin && (
            <button style={styles.controlBtn} onClick={handleExportCsv} disabled={exporting}>
              {exporting
                ? "Exporting…"
                : `Export CSV (${selectedIds.size > 0 ? selectedIds.size : sortedCards.length})`}
            </button>
          )}
          <button style={styles.controlBtn} onClick={exitSelectMode}>Done</button>
        </div>
      )}

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
          showTriage={isAdmin && triageStatusIds.size > 0}
          showMarket={isAdmin}
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
            mobileCardsPerRow={mobileCardsPerRow}
          />
        </div>
      </div>

      {/* Bulk edit modal — admin path mutates catalog rows. */}
      {isAdmin && showBulkEdit && selectedCards.length > 0 && (
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
      )}

      {/* Bulk add modal — guest path inserts guest_card_copies rows. */}
      {!isAdmin && showBulkEdit && selectedCards.length > 0 && GuestPhotocardBulkAdd && (
        <Suspense fallback={null}>
          <GuestPhotocardBulkAdd
            selectedCards={selectedCards}
            ownershipStatuses={ownershipStatuses}
            onClose={() => setShowBulkEdit(false)}
            onSaved={async (summary) => {
              setShowBulkEdit(false);
              exitSelectMode();
              await reloadCards();
              if (summary) {
                window.alert(summary);
              }
            }}
          />
        </Suspense>
      )}

      {/* Detail modal — admin path edits the catalog, guest path edits local
          guest_card_copies (catalog data is read-only on the guest side). */}
      {detailCard && isAdmin && (
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
      {detailCard && !isAdmin && GuestPhotocardDetailModal && (
        <Suspense fallback={null}>
          <GuestPhotocardDetailModal
            card={detailCard}
            allCards={sortedCards}
            ownershipStatuses={ownershipStatuses}
            onClose={() => setDetailCard(null)}
            onChanged={reloadCards}
          />
        </Suspense>
      )}

      {/* Trade-page creation — same modal for admin and guest. */}
      {showTradeCreate && selectedCards.length > 0 && (
        <TradeCreateModal
          selectedCards={selectedCards}
          onClose={() => setShowTradeCreate(false)}
          onCreated={() => {
            // Leave the modal open so the user can copy the URL; once they
            // close it, exit select mode so the toolbar resets cleanly.
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
  selectBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexShrink: 0,
    flexWrap: "wrap",
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
};
