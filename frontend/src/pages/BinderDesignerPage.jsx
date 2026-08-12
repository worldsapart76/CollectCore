import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBinderPlacements,
  fetchOwnershipStatuses,
  fetchPhotocardGroups,
  fetchTopLevelCategories,
  getBinder,
  listBinders,
  listPhotocards,
  saveBinderPages,
} from "../api";
import PhotocardFilters from "../components/photocard/PhotocardFilters";
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  TRIAGE_STATUS_CODES,
  applyPhotocardFilters,
  deriveFilterMembers,
  deriveFilterSourceOrigins,
  deriveFilterVersions,
  sortPhotocards,
} from "../components/photocard/photocardFiltering";
import BinderSheet, { BinderCover } from "../components/binder/BinderSheet";
import CardTray from "../components/binder/CardTray";
import BinderManageModal from "../components/binder/BinderManageModal";
import WantedSweepModal from "../components/binder/WantedSweepModal";
import {
  CANVAS_PADDING,
  SPREAD_GAP,
  fitPocketWidth,
  pocketCount,
} from "../components/binder/binderLayout";
import { binderDesignerState, persistLastBinderId } from "../binderPageState";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;
const TRAY_INCREMENT = 100;
const MOBILE_BREAKPOINT = "(max-width: 768px)";

// A card already Owned, Wanted, or held for Trade is not a want. The first two
// are self-evident; `trade` is here because `wanted` cannot co-exist with it
// (triage plan co-occurrence table), so offering it would be a guaranteed skip.
const NOT_A_WANT = ["owned", "wanted", "trade"];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/** Serialize pages for the dirty check. Integer-like object keys iterate in
 *  numeric order, so the same layout always produces the same string. */
function snapshot(pages) {
  return JSON.stringify(pages.map((p) => p.slots));
}

/**
 * Binder Designer — plan how a physical binder gets filled.
 *
 * See docs/photocard_binder_designer_plan.md.
 *
 * Everything is staged client-side until Save (the Batch Images model). The
 * available-cards tray is *derived* — filtered cards minus everything in a
 * pocket — so a card pulled out of a page reappears at its sort position with
 * no bookkeeping.
 *
 * Two ways to move a card, because drag-and-drop doesn't exist on touch:
 * drag it, or tap it and then tap where it goes. Both run the same two
 * functions (placeFromTray / moveSlot).
 */
export default function BinderDesignerPage() {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  // Library data
  const [cards, setCards] = useState([]);
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // One cache-bust value per card load. Slots re-render constantly during a
  // drag; a per-render Date.now() would re-request every visible image.
  const [cacheBust, setCacheBust] = useState(() => Date.now());

  // Binders
  const [binders, setBinders] = useState([]);
  const [binderId, setBinderId] = useState(binderDesignerState.binderId);
  const [binder, setBinder] = useState(null);
  const [pages, setPages] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState("[]");
  const [placements, setPlacements] = useState({});

  // View
  const [viewMode, setViewMode] = useState(binderDesignerState.viewMode);
  const [pageIndex, setPageIndex] = useState(0);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);

  // Tray
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...(binderDesignerState.filters ?? {}),
  }));
  const [sortMode, setSortMode] = useState(binderDesignerState.sortMode);
  const [trayLimit, setTrayLimit] = useState(TRAY_INCREMENT);

  // The card picked up by tapping — from the tray or out of a pocket.
  // { kind: 'tray', itemId } | { kind: 'slot', pageIndex, slotIndex } | null
  const [armed, setArmed] = useState(null);

  // Modals / status
  const [manageMode, setManageMode] = useState(null); // 'create' | 'edit' | null
  const [sweepCandidates, setSweepCandidates] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [saveError, setSaveError] = useState("");

  const dragRef = useRef(null);

  // Persist view state across navigation
  useEffect(() => {
    binderDesignerState.filters = filters;
    binderDesignerState.sortMode = sortMode;
    binderDesignerState.viewMode = viewMode;
  }, [filters, sortMode, viewMode]);

  // ── Load ──
  const reloadCards = useCallback(async () => {
    const data = await listPhotocards();
    setCards(data);
    setCacheBust(Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cardData, groupData, categoryData, statusData, binderData, placementData] =
          await Promise.all([
            listPhotocards(),
            fetchPhotocardGroups(),
            fetchTopLevelCategories(COLLECTION_TYPE_ID),
            fetchOwnershipStatuses(COLLECTION_TYPE_ID),
            listBinders(),
            fetchBinderPlacements(),
          ]);
        if (cancelled) return;
        setCards(cardData);
        setGroups(groupData);
        setCategories(categoryData);
        setOwnershipStatuses(statusData);
        setBinders(binderData);
        setPlacements(placementData);
        setCacheBust(Date.now());
        setBinderId((prev) =>
          binderData.some((b) => b.binder_id === prev)
            ? prev
            : (binderData[0]?.binder_id ?? null)
        );
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load the selected binder's structure.
  //
  // Gated on `loading` so it never fires with an unvalidated id: binderId is
  // seeded from localStorage, and the binder it names may have been deleted
  // since. The initial load above corrects it to the first real binder, and
  // waiting means we only ever request one that exists.
  useEffect(() => {
    if (loading) return;
    if (binderId == null) { setBinder(null); setPages([]); setSavedSnapshot("[]"); return; }
    let cancelled = false;
    getBinder(binderId)
      .then((data) => {
        if (cancelled) return;
        const next = data.pages.map((p) => ({
          slots: Object.fromEntries(p.slots.map((s) => [s.slot_index, s.item_id])),
        }));
        setBinder(data.binder);
        setPages(next);
        setSavedSnapshot(snapshot(next));
        setPageIndex(0);
        setSpreadIndex(0);
        setShowBack(false);
        setArmed(null);
        setStatusMsg("");
        setSaveError("");
      })
      .catch((err) => {
        // Deleted in another tab, say. Not fatal — drop the selection and let
        // the user pick another binder, rather than replacing the whole page
        // with an error it can never recover from.
        if (cancelled) return;
        setSaveError(err.message || "Failed to load that binder.");
        setBinder(null);
        setPages([]);
        setSavedSnapshot("[]");
      });
    persistLastBinderId(binderId);
    return () => { cancelled = true; };
  }, [binderId, loading]);

  // ── Derived ──
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.item_id, c])), [cards]);

  const statusCodeById = useMemo(
    () => new Map(ownershipStatuses.map((s) => [s.ownership_status_id, s.status_code])),
    [ownershipStatuses]
  );
  const wantedStatusId = useMemo(
    () => ownershipStatuses.find((s) => s.status_code === "wanted")?.ownership_status_id ?? null,
    [ownershipStatuses]
  );
  const triageStatusIds = useMemo(
    () => new Set(
      ownershipStatuses
        .filter((s) => TRIAGE_STATUS_CODES.includes(s.status_code))
        .map((s) => s.ownership_status_id)
    ),
    [ownershipStatuses]
  );

  const filterMembers = useMemo(() => deriveFilterMembers(cards), [cards]);
  const filterVersions = useMemo(
    () => deriveFilterVersions(cards, filters.sourceOrigin),
    [cards, filters.sourceOrigin]
  );
  const filterSourceOrigins = useMemo(() => deriveFilterSourceOrigins(cards), [cards]);

  const placedHere = useMemo(() => {
    const set = new Set();
    for (const page of pages) {
      for (const id of Object.values(page.slots)) set.add(id);
    }
    return set;
  }, [pages]);

  // "A card lives in one binder only" — anything held by a different binder is
  // gone from this tray, saved or not.
  const placedElsewhere = useMemo(() => {
    const set = new Set();
    for (const [itemId, info] of Object.entries(placements)) {
      if (info.binder_id !== binderId) set.add(Number(itemId));
    }
    return set;
  }, [placements, binderId]);

  const availableCards = useMemo(() => {
    const filtered = applyPhotocardFilters(cards, filters, triageStatusIds);
    const sorted = sortPhotocards(filtered, sortMode);
    return sorted.filter(
      (c) => !placedHere.has(c.item_id) && !placedElsewhere.has(c.item_id)
    );
  }, [cards, filters, triageStatusIds, sortMode, placedHere, placedElsewhere]);

  useEffect(() => { setTrayLimit(TRAY_INCREMENT); }, [filters, sortMode]);

  const dirty = useMemo(() => snapshot(pages) !== savedSnapshot, [pages, savedSnapshot]);

  // Warn before losing staged placements
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Sizing ──
  // Sheets fill whatever room the canvas has instead of using fixed sizes, so a
  // wide monitor gets a big binder and a phone gets a small one — and neither
  // scrolls. Measured with a ResizeObserver because the canvas also changes
  // width when the filter sidebar is present and when the window resizes.
  // Spread is a desktop view — two sheets side by side don't fit a phone.
  const effectiveViewMode = isMobile ? "page" : viewMode;
  const sheetsOnScreen = effectiveViewMode === "spread" ? 2 : 1;
  const hasSheetArea = !!binder && pages.length > 0;

  const canvasRef = useRef(null);
  const [canvasBox, setCanvasBox] = useState({ width: 0, height: 0 });
  // Re-observe whenever the element is swapped out — switching view mode or
  // binder unmounts one sheet area and mounts another, and an observer left
  // pointing at the old node would freeze the size at its last value.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasBox({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, binderId, isMobile, effectiveViewMode, hasSheetArea]);

  const pocketWidth = useMemo(() => {
    if (!binder || !canvasBox.width || !canvasBox.height) return 0;
    return fitPocketWidth({
      width: canvasBox.width,
      height: canvasBox.height,
      layoutCode: binder.layout_code,
      sheets: sheetsOnScreen,
    });
  }, [binder, canvasBox, sheetsOnScreen]);

  // ── Mutations ──
  function markChanged() {
    setStatusMsg("");
    setSaveError("");
  }

  const placeFromTray = useCallback((itemId, targetPage, targetSlot) => {
    setPages((prev) => {
      const next = prev.map((p) => ({ slots: { ...p.slots } }));
      if (!next[targetPage]) return prev;
      // A card displaced by this drop simply returns to the tray — the list is
      // derived, so there's nothing to put it back into.
      next[targetPage].slots[targetSlot] = itemId;
      return next;
    });
    markChanged();
  }, []);

  const moveSlot = useCallback((fromPage, fromSlot, targetPage, targetSlot) => {
    if (fromPage === targetPage && fromSlot === targetSlot) return;
    setPages((prev) => {
      const next = prev.map((p) => ({ slots: { ...p.slots } }));
      const from = next[fromPage];
      const target = next[targetPage];
      if (!from || !target) return prev;
      const moving = from.slots[fromSlot];
      if (moving == null) return prev;
      const displaced = target.slots[targetSlot];
      delete from.slots[fromSlot];
      target.slots[targetSlot] = moving;
      // Occupied target → swap, rather than evicting a card you didn't touch.
      if (displaced != null) from.slots[fromSlot] = displaced;
      return next;
    });
    markChanged();
  }, []);

  function handleDropSlot(targetPage, targetSlot) {
    const src = dragRef.current;
    dragRef.current = null;
    if (!src) return;
    if (src.kind === "tray") placeFromTray(src.itemId, targetPage, targetSlot);
    else moveSlot(src.pageIndex, src.slotIndex, targetPage, targetSlot);
    setArmed(null);
  }

  // Tap-to-move: an empty tap on a filled pocket picks that card up; the next
  // tap on any pocket drops it. This is the whole editing model on touch.
  function handleSlotClick(targetPage, targetSlot) {
    if (!armed) {
      if (pages[targetPage]?.slots[targetSlot] != null) {
        setArmed({ kind: "slot", pageIndex: targetPage, slotIndex: targetSlot });
      }
      return;
    }
    if (armed.kind === "slot" && armed.pageIndex === targetPage && armed.slotIndex === targetSlot) {
      setArmed(null); // tapped the card again — put it back down
      return;
    }
    if (armed.kind === "tray") placeFromTray(armed.itemId, targetPage, targetSlot);
    else moveSlot(armed.pageIndex, armed.slotIndex, targetPage, targetSlot);
    setArmed(null);
  }

  function handleRemoveSlot(targetPage, targetSlot) {
    setPages((prev) => {
      const next = prev.map((p) => ({ slots: { ...p.slots } }));
      if (!next[targetPage]) return prev;
      delete next[targetPage].slots[targetSlot];
      return next;
    });
    setArmed(null);
    markChanged();
  }

  function addPage(afterIndex = null) {
    setPages((prev) => {
      const next = prev.map((p) => ({ slots: { ...p.slots } }));
      const at = afterIndex == null ? next.length : afterIndex + 1;
      next.splice(at, 0, { slots: {} });
      return next;
    });
    markChanged();
  }

  function deletePage(index) {
    const held = Object.keys(pages[index]?.slots || {}).length;
    if (held && !window.confirm(
      `Delete page ${index + 1}? ${held} card${held !== 1 ? "s" : ""} will return to the available list.`
    )) return;
    setPages((prev) => prev.filter((_, i) => i !== index));
    setPageIndex((i) => Math.max(0, Math.min(i, pages.length - 2)));
    setSpreadIndex((i) => Math.max(0, Math.min(i, pages.length - 1)));
    setArmed(null);
    markChanged();
  }

  // ── Save ──
  async function handleSave() {
    if (binderId == null) return;
    setSaving(true);
    setSaveError("");
    setStatusMsg("");
    const payload = pages.map((p) => ({
      slots: Object.entries(p.slots).map(([slotIndex, itemId]) => ({
        slot_index: Number(slotIndex),
        item_id: itemId,
      })),
    }));
    try {
      const result = await saveBinderPages(binderId, payload);
      setSavedSnapshot(snapshot(pages));
      setStatusMsg(`Saved — ${result.placed_count} card${result.placed_count !== 1 ? "s" : ""} across ${result.page_count} page${result.page_count !== 1 ? "s" : ""}.`);
      const [freshPlacements, freshBinders] = await Promise.all([
        fetchBinderPlacements(),
        listBinders(),
      ]);
      setPlacements(freshPlacements);
      setBinders(freshBinders);

      // Offer the Wanted sweep for anything placed that isn't collected yet.
      if (wantedStatusId != null) {
        const candidates = [...placedHere]
          .map((id) => cardsById.get(id))
          .filter(Boolean)
          .filter((c) => !(c.copies || []).some(
            (cp) => NOT_A_WANT.includes(statusCodeById.get(cp.ownership_status_id))
          ));
        if (candidates.length) setSweepCandidates(candidates);
      }
    } catch (err) {
      if (err.conflicts?.length) {
        const names = err.conflicts
          .map((c) => {
            const card = cardsById.get(c.item_id);
            const label = card?.members?.join(", ") || `#${c.item_id}`;
            return `${label} (in ${c.binder_name})`;
          })
          .join("; ");
        setSaveError(`Nothing saved — these cards are already in another binder: ${names}. Refreshing the available list.`);
        fetchBinderPlacements().then(setPlacements).catch(() => {});
      } else {
        setSaveError(err.message || "Failed to save binder.");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSelectBinder(nextId) {
    if (dirty && !window.confirm("Discard unsaved changes to this binder?")) return;
    setBinderId(nextId);
  }

  // ── Render ──
  if (loading) return <div style={{ padding: 24 }}>Loading binders…</div>;
  if (error) return <div style={{ padding: 24, color: "var(--error-text)" }}>Error: {error}</div>;

  const pockets = binder ? pocketCount(binder.layout_code) : 0;
  const spreadCount = pages.length + 1;
  const armedItemId = armed?.kind === "tray" ? armed.itemId : null;

  const sheetProps = {
    binder,
    pages,
    cardsById,
    pocketWidth,
    armed: !!armed,
    armedSlot: armed?.kind === "slot" ? armed : null,
    cacheBust,
    dragRef,
    isMobile,
    onDropSlot: handleDropSlot,
    onRemoveSlot: handleRemoveSlot,
    onSlotClick: handleSlotClick,
    onAddPage: addPage,
    onDeletePage: deletePage,
  };

  return (
    <div style={styles.page}>
      {/* Controls bar */}
      <div style={styles.controlsBar}>
        <div style={styles.controlsLeft}>
          <div style={styles.controlGroup}>
            <span style={styles.controlLabel}>Binder</span>
            <select
              value={binderId ?? ""}
              onChange={(e) => handleSelectBinder(e.target.value ? Number(e.target.value) : null)}
              style={styles.controlSelect}
            >
              {binders.length === 0 && <option value="">— none yet —</option>}
              {binders.map((b) => (
                <option key={b.binder_id} value={b.binder_id}>
                  {b.binder_name} ({b.layout_code})
                </option>
              ))}
            </select>
            <button type="button" style={styles.controlBtn} onClick={() => setManageMode("create")}>
              New
            </button>
            {binder && (
              <button type="button" style={styles.controlBtn} onClick={() => setManageMode("edit")}>
                Edit
              </button>
            )}
          </div>

          {binder && !isMobile && (
            <>
              <ToggleGroup
                label="View"
                options={[
                  { value: "page", label: "Page" },
                  { value: "spread", label: "Spread" },
                ]}
                value={viewMode}
                onChange={setViewMode}
              />
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
            </>
          )}
        </div>

        <div style={styles.controlsRight}>
          {binder && (
            <span style={styles.count}>
              {placedHere.size} / {pages.length * pockets}
              {isMobile ? "" : " pockets filled"}
              {dirty ? " · unsaved" : ""}
            </span>
          )}
          {binder && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              style={{ ...styles.controlBtn, ...styles.primaryBtn, opacity: saving || !dirty ? 0.5 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {(saveError || statusMsg) && (
        <div style={saveError ? styles.alertError : styles.alertSuccess}>
          {saveError || statusMsg}
        </div>
      )}

      <div style={isMobile ? styles.bodyMobile : styles.body}>
        {/* Below 768px this renders as an off-canvas drawer (position: fixed),
            opened from the TopNav filter icon — it takes no layout space. */}
        <PhotocardFilters
          groups={groups}
          members={filterMembers}
          categories={categories}
          sourceOrigins={filterSourceOrigins}
          versions={filterVersions}
          ownershipStatuses={ownershipStatuses}
          filters={filters}
          onSectionChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClearAll={() => setFilters(DEFAULT_FILTERS)}
          showTriage={triageStatusIds.size > 0}
        />

        {!isMobile && (
          <div style={styles.trayColumn}>
            <CardTray
              cards={availableCards}
              limit={trayLimit}
              onShowMore={() => setTrayLimit((n) => n + TRAY_INCREMENT)}
              armedItemId={armedItemId}
              onArm={(itemId) => setArmed(itemId == null ? null : { kind: "tray", itemId })}
              onDragStart={(itemId) => { dragRef.current = { kind: "tray", itemId }; }}
              onDragEnd={() => { dragRef.current = null; }}
              cacheBust={cacheBust}
            />
          </div>
        )}

        <div style={styles.canvas}>
          {!binder ? (
            <div style={styles.emptyState}>
              No binders yet.{" "}
              <button type="button" style={styles.controlBtn} onClick={() => setManageMode("create")}>Create one</button>
            </div>
          ) : pages.length === 0 ? (
            <div style={styles.emptyState}>
              This binder has no pages.{" "}
              <button type="button" style={styles.controlBtn} onClick={() => addPage()}>Add a page</button>
            </div>
          ) : effectiveViewMode === "page" ? (
            <PageView
              {...sheetProps}
              canvasRef={canvasRef}
              pageIndex={Math.min(pageIndex, pages.length - 1)}
              setPageIndex={setPageIndex}
              showBack={showBack}
              setShowBack={setShowBack}
            />
          ) : (
            <SpreadView
              {...sheetProps}
              canvasRef={canvasRef}
              spreadIndex={Math.min(spreadIndex, spreadCount - 1)}
              setSpreadIndex={setSpreadIndex}
            />
          )}
        </div>

        {isMobile && (
          <CardTray
            orientation="horizontal"
            cards={availableCards}
            limit={trayLimit}
            onShowMore={() => setTrayLimit((n) => n + TRAY_INCREMENT)}
            armedItemId={armedItemId}
            onArm={(itemId) => setArmed(itemId == null ? null : { kind: "tray", itemId })}
            onDragStart={(itemId) => { dragRef.current = { kind: "tray", itemId }; }}
            onDragEnd={() => { dragRef.current = null; }}
            cacheBust={cacheBust}
          />
        )}
      </div>

      {manageMode && (
        <BinderManageModal
          mode={manageMode}
          binder={manageMode === "edit" ? { ...binder, placed_count: placedHere.size } : null}
          onClose={() => setManageMode(null)}
          onSaved={async (saved) => {
            setManageMode(null);
            setBinders(await listBinders());
            if (saved?.binder_id && saved.binder_id !== binderId) setBinderId(saved.binder_id);
            else setBinder((prev) => ({ ...prev, ...saved }));
          }}
          onDeleted={async (deletedId) => {
            setManageMode(null);
            const fresh = await listBinders();
            setBinders(fresh);
            setPlacements(await fetchBinderPlacements());
            if (binderId === deletedId) setBinderId(fresh[0]?.binder_id ?? null);
          }}
        />
      )}

      {sweepCandidates && (
        <WantedSweepModal
          candidates={sweepCandidates}
          wantedStatusId={wantedStatusId}
          statusCodeById={statusCodeById}
          onClose={() => setSweepCandidates(null)}
          onDone={async (summary) => {
            setSweepCandidates(null);
            setStatusMsg(summary);
            await reloadCards().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

function PageView({
  binder, pages, pageIndex, setPageIndex, showBack, setShowBack,
  cardsById, pocketWidth, armed, armedSlot, cacheBust, dragRef, isMobile, canvasRef,
  onDropSlot, onRemoveSlot, onSlotClick, onAddPage, onDeletePage,
}) {
  const page = pages[pageIndex];

  return (
    <>
      <div style={styles.canvasBar}>
        <button type="button" style={styles.controlBtn} disabled={pageIndex === 0}
          onClick={() => setPageIndex(pageIndex - 1)}>← Prev</button>
        <span style={styles.canvasLabel}>Page {pageIndex + 1} of {pages.length}</span>
        <button type="button" style={styles.controlBtn} disabled={pageIndex >= pages.length - 1}
          onClick={() => setPageIndex(pageIndex + 1)}>Next →</button>

        <label style={styles.checkLabel}>
          <input type="checkbox" checked={showBack} onChange={(e) => setShowBack(e.target.checked)}
            style={{ marginRight: 4 }} />
          Backs
        </label>

        <span style={styles.spacer} />
        {/* Restructuring a binder is a desk job — the phone keeps just the
            navigation and an append, so the bar stays one row. */}
        {!isMobile && (
          <button type="button" style={styles.controlBtn} onClick={() => onAddPage(pageIndex)}>Insert page after</button>
        )}
        <button type="button" style={styles.controlBtn} onClick={() => onAddPage()}>
          {isMobile ? "+ Page" : "Add page at end"}
        </button>
        {!isMobile && (
          <button type="button" style={styles.controlBtn} onClick={() => onDeletePage(pageIndex)}
            disabled={pages.length <= 1}>Delete page</button>
        )}
      </div>

      <div style={styles.sheetArea} ref={canvasRef}>
        {pocketWidth > 0 && (
          <BinderSheet
            layoutCode={binder.layout_code}
            slots={page.slots}
            cardsById={cardsById}
            side={showBack ? "back" : "front"}
            pocketWidth={pocketWidth}
            armed={armed}
            armedSlot={armedSlot?.pageIndex === pageIndex ? armedSlot.slotIndex : null}
            cacheBust={cacheBust}
            label={showBack ? `Page ${pageIndex + 1} — back` : `Page ${pageIndex + 1} — front`}
            onDropSlot={(slotIndex) => onDropSlot(pageIndex, slotIndex)}
            onRemoveSlot={(slotIndex) => onRemoveSlot(pageIndex, slotIndex)}
            onSlotClick={(slotIndex) => onSlotClick(pageIndex, slotIndex)}
            onDragStartSlot={(slotIndex) => { dragRef.current = { kind: "slot", pageIndex, slotIndex }; }}
            onDragEndSlot={() => { dragRef.current = null; }}
          />
        )}
      </div>
    </>
  );
}

/**
 * True open-binder view. Spread s shows the BACK of sheet s-1 on the left and
 * the FRONT of sheet s on the right — what you actually see with the binder
 * lying open. The left page is read-only: it is the reverse of a sheet you edit
 * from its own front, and accepting drops there would mean two coordinate
 * systems for one pocket. Clicking its label jumps to that sheet's spread.
 */
function SpreadView({
  binder, pages, spreadIndex, setSpreadIndex,
  cardsById, pocketWidth, armed, armedSlot, cacheBust, dragRef, canvasRef,
  onDropSlot, onRemoveSlot, onSlotClick, onAddPage, onDeletePage,
}) {
  const leftIndex = spreadIndex - 1;      // sheet shown back-side-up on the left
  const rightIndex = spreadIndex;         // sheet shown front-side-up on the right
  const hasLeft = leftIndex >= 0;
  const hasRight = rightIndex < pages.length;

  return (
    <>
      <div style={styles.canvasBar}>
        <button type="button" style={styles.controlBtn} disabled={spreadIndex === 0}
          onClick={() => setSpreadIndex(spreadIndex - 1)}>← Prev</button>
        <span style={styles.canvasLabel}>Spread {spreadIndex + 1} of {pages.length + 1}</span>
        <button type="button" style={styles.controlBtn} disabled={spreadIndex >= pages.length}
          onClick={() => setSpreadIndex(spreadIndex + 1)}>Next →</button>

        <span style={styles.spacer} />
        {hasRight && (
          <>
            <button type="button" style={styles.controlBtn} onClick={() => onAddPage(rightIndex)}>Insert page after</button>
            <button type="button" style={styles.controlBtn} onClick={() => onDeletePage(rightIndex)}
              disabled={pages.length <= 1}>Delete page</button>
          </>
        )}
        <button type="button" style={styles.controlBtn} onClick={() => onAddPage()}>Add page at end</button>
      </div>

      <div style={{ ...styles.sheetArea, gap: SPREAD_GAP }} ref={canvasRef}>
        {pocketWidth > 0 && (hasLeft ? (
          <BinderSheet
            layoutCode={binder.layout_code}
            slots={pages[leftIndex].slots}
            cardsById={cardsById}
            side="back"
            pocketWidth={pocketWidth}
            cacheBust={cacheBust}
            label={`Page ${leftIndex + 1} — back`}
            onLabelClick={() => setSpreadIndex(leftIndex)}
          />
        ) : (
          <BinderCover label="Inside front cover" pocketWidth={pocketWidth} layoutCode={binder.layout_code} />
        ))}

        {pocketWidth > 0 && (hasRight ? (
          <BinderSheet
            layoutCode={binder.layout_code}
            slots={pages[rightIndex].slots}
            cardsById={cardsById}
            side="front"
            pocketWidth={pocketWidth}
            armed={armed}
            armedSlot={armedSlot?.pageIndex === rightIndex ? armedSlot.slotIndex : null}
            cacheBust={cacheBust}
            label={`Page ${rightIndex + 1} — front`}
            onDropSlot={(slotIndex) => onDropSlot(rightIndex, slotIndex)}
            onRemoveSlot={(slotIndex) => onRemoveSlot(rightIndex, slotIndex)}
            onSlotClick={(slotIndex) => onSlotClick(rightIndex, slotIndex)}
            onDragStartSlot={(slotIndex) => { dragRef.current = { kind: "slot", pageIndex: rightIndex, slotIndex }; }}
            onDragEndSlot={() => { dragRef.current = null; }}
          />
        ) : (
          <BinderCover label="Inside back cover" pocketWidth={pocketWidth} layoutCode={binder.layout_code} />
        ))}
      </div>
    </>
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
            style={{ ...styles.toggleBtn, ...(value === opt.value ? styles.toggleBtnActive : {}) }}
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
  controlsLeft: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  controlsRight: { display: "flex", alignItems: "center", gap: 8 },
  controlGroup: { display: "flex", alignItems: "center", gap: 5 },
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
    maxWidth: 260,
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
  count: { fontSize: 12, color: "var(--text-muted)", fontWeight: "bold" },
  checkLabel: { display: "flex", alignItems: "center", fontSize: 12, cursor: "pointer" },
  spacer: { flex: 1 },
  alertError: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--danger-text)",
    background: "var(--error-bg)",
    fontSize: "var(--text-sm)",
    flexShrink: 0,
  },
  alertSuccess: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--success-border)",
    background: "var(--success-bg)",
    fontSize: "var(--text-sm)",
    flexShrink: 0,
  },
  body: { display: "flex", flex: 1, overflow: "hidden", minHeight: 0 },
  bodyMobile: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
  },
  trayColumn: { width: 210, flexShrink: 0, display: "flex", minHeight: 0 },
  canvas: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
    minHeight: 0,
  },
  canvasBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  canvasLabel: { fontSize: 12, color: "var(--text-secondary)", fontWeight: "bold" },
  // overflow: hidden, not auto — the sheet is measured to fit this box, so a
  // scrollbar here would mean the measurement was wrong.
  sheetArea: {
    flex: 1,
    overflow: "hidden",
    padding: CANVAS_PADDING,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: 0,
    boxSizing: "border-box",
  },
  emptyState: {
    padding: 32,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
};
