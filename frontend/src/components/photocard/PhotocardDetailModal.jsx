import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchPhotocardMembers,
  fetchPhotocardGroupOrigins,
  fetchOwnershipStatuses,
  createPhotocardSourceOrigin,
  updatePhotocard,
  deletePhotocard,
  replaceFrontImage,
  replaceBackImage,
  createPhotocardCopy,
  updatePhotocardCopy,
  deletePhotocardCopy,
} from "../../api";
import { API_BASE, getImageUrl } from "../../utils/imageUrl";
import { useSwipeNav } from "../../hooks/useSwipeNav";

const usdc = (cents) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`);

// One money figure with its rung named. A bare dollar amount in a modal that
// shows three of them is how "sell" came to mean two different things.
function MarketFigure({ label, cents, note }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.25 }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{label}</span>
      <strong style={{ fontSize: "var(--text-base)" }}>
        {cents == null ? "—" : `$${(cents / 100).toFixed(2)}`}
      </strong>
      {note && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{note}</span>
      )}
    </span>
  );
}

function resolveCardSrc(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${getImageUrl(path)}?v=${Date.now()}`;
}
import { COLLECTION_TYPE_IDS } from "../../constants/collectionTypes";

/**
 * PhotocardDetailModal — view and edit a single photocard.
 *
 * Props:
 *   card           — initial photocard object (from list)
 *   allCards       — optional sorted array; enables Prev/Next navigation
 *   groups         — all groups array
 *   categories     — all categories array
 *   onClose        — callback() — close the modal
 *   onSaved        — callback() — cards updated; parent should reload (does NOT close)
 *   onDeleted      — callback(item_id) — called after successful delete
 */
export default function PhotocardDetailModal({
  card,
  allCards,
  groups,
  categories,
  onClose,
  onSaved,
  onDeleted,
}) {
  // Navigation — track position in the sorted cards array
  const effectiveAllCards = allCards ?? [card];
  const [currentIndex, setCurrentIndex] = useState(
    () => Math.max(0, effectiveAllCards.findIndex((c) => c.item_id === card.item_id))
  );
  const currentCard = effectiveAllCards[currentIndex] ?? card;
  const navigate = useNavigate();

  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [members, setMembers] = useState([]);
  // Every active origin in the card's group across all categories, for the
  // Source Origins picker (secondary origins cross categories on purpose).
  const [groupOrigins, setGroupOrigins] = useState([]);

  // Form state — reset to currentCard values when card changes
  const [topLevelCategoryId, setTopLevelCategoryId] = useState(
    String(currentCard.top_level_category_id)
  );
  // Primary source origin (the ★ chip). Its category IS the card's category.
  const [primary, setPrimary] = useState(() => primaryFromCard(currentCard));
  const [version, setVersion] = useState(currentCard.version || "");
  const [isSpecial, setIsSpecial] = useState(currentCard.is_special ?? true);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  // Secondary origins ("Also in"). Only sent on save once touched, so a stale
  // card object can never overwrite them by accident.
  const [secondaryOrigins, setSecondaryOrigins] = useState(currentCard.secondary_origins || []);
  const [secondaryTouched, setSecondaryTouched] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  // Dirty state — true when any form field has been changed since last save/navigation
  const [isDirty, setIsDirty] = useState(false);
  // Copies-changed flag — true when any copy was added/edited/deleted. The
  // copy edits are persisted immediately by the API, but we defer signalling
  // the parent to reload until the user leaves the card so a change that
  // moves the card out of the active filter doesn't yank it from view.
  const [copiesChanged, setCopiesChanged] = useState(false);
  // Image state
  const [frontImagePath, setFrontImagePath] = useState(currentCard.front_image_path || null);
  const [backImagePath, setBackImagePath] = useState(currentCard.back_image_path || null);
  const [replacingFront, setReplacingFront] = useState(false);
  const [replacingBack, setReplacingBack] = useState(false);
  const [imageError, setImageError] = useState("");
  const frontFileRef = useRef(null);
  const backFileRef = useRef(null);

  // Load ownership statuses once on mount
  useEffect(() => {
    fetchOwnershipStatuses(COLLECTION_TYPE_IDS.photocards)
      .then(setOwnershipStatuses)
      .catch(() => {});
  }, []);

  // Reset form and reload per-card data whenever the current card changes
  useEffect(() => {
    setTopLevelCategoryId(String(currentCard.top_level_category_id));
    setPrimary(primaryFromCard(currentCard));
    setVersion(currentCard.version || "");
    setIsSpecial(currentCard.is_special ?? true);
    setSelectedMemberIds([]);
    setSecondaryOrigins(currentCard.secondary_origins || []);
    setSecondaryTouched(false);
    setFrontImagePath(currentCard.front_image_path || null);
    setBackImagePath(currentCard.back_image_path || null);
    setIsDirty(false);
    setCopiesChanged(false);
    setError("");
    setImageError("");
    setConfirmDelete(false);

    async function loadCardData() {
      try {
        const [memberData, groupOriginData] = await Promise.all([
          fetchPhotocardMembers(currentCard.group_id),
          fetchPhotocardGroupOrigins(currentCard.group_id),
        ]);
        setMembers(memberData);
        setGroupOrigins(groupOriginData);

        const memberNameSet = new Set(currentCard.members || []);
        const matched = memberData
          .filter((m) => memberNameSet.has(m.member_name))
          .map((m) => String(m.member_id));
        setSelectedMemberIds(matched);
      } catch (err) {
        setError(err.message || "Failed to load form data");
      }
    }
    loadCardData();
  }, [currentCard.item_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMember(memberId) {
    const id = String(memberId);
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
    setIsDirty(true);
  }

  // The primary as a full origin row (name + category) once the group's
  // origins have loaded; until then (or for a merged-away origin, which the
  // picker endpoint omits) the card's own fields stand in.
  const primaryInfo = primary
    ? groupOrigins.find((o) => o.source_origin_id === primary.source_origin_id) || primary
    : null;

  // Category follows the primary origin: origins live in one category, so the
  // card's category is whatever its primary's is. Only a card with no origin
  // at all keeps a free category choice.
  const effectiveCategoryId = primaryInfo?.top_level_category_id
    ? String(primaryInfo.top_level_category_id)
    : topLevelCategoryId;
  const effectiveCategoryName =
    categories.find((c) => String(c.top_level_category_id) === effectiveCategoryId)?.category_name ||
    primaryInfo?.category_name ||
    "—";

  // Origins the picker may still offer: not already on this card.
  const pickableOrigins = groupOrigins.filter(
    (o) =>
      o.source_origin_id !== primary?.source_origin_id &&
      !secondaryOrigins.some((s) => s.source_origin_id === o.source_origin_id)
  );

  // Only reachable when the card has no origin yet.
  function handleCategoryChange(newCatId) {
    setTopLevelCategoryId(newCatId);
    setIsDirty(true);
  }

  // A picked origin becomes the primary if the card has none, otherwise it is
  // added alongside ("also in").
  function addOrigin(origin) {
    if (!primary) {
      setPrimary(origin);
    } else {
      setSecondaryOrigins((prev) => sortByName([...prev, origin]));
      setSecondaryTouched(true);
    }
    setIsDirty(true);
  }

  // Star a secondary: it becomes the primary (and sets the category), the old
  // primary drops back to a normal chip. The PUT sends both, and the backend
  // drops the new primary from the secondary list on its side too.
  function makePrimary(origin) {
    setSecondaryOrigins((prev) =>
      sortByName([
        ...prev.filter((o) => o.source_origin_id !== origin.source_origin_id),
        ...(primaryInfo ? [primaryInfo] : []),
      ])
    );
    setPrimary(origin);
    setSecondaryTouched(true);
    setIsDirty(true);
  }

  function removeSecondaryOrigin(originId) {
    setSecondaryOrigins((prev) => prev.filter((o) => o.source_origin_id !== originId));
    setSecondaryTouched(true);
    setIsDirty(true);
  }

  // Create a brand-new origin from the picker, then add it like any pick.
  async function createOrigin(name, categoryId) {
    const created = await createPhotocardSourceOrigin({
      groupId: currentCard.group_id,
      categoryId,
      sourceOriginName: name,
    });
    const refreshed = await fetchPhotocardGroupOrigins(currentCard.group_id);
    setGroupOrigins(refreshed);
    const row = refreshed.find((o) => o.source_origin_id === created.source_origin_id) || {
      source_origin_id: created.source_origin_id,
      source_origin_name: created.source_origin_name,
      top_level_category_id: categoryId,
    };
    addOrigin(row);
  }

  async function handleReplaceImage(side, file) {
    setImageError("");
    if (side === "front") {
      setReplacingFront(true);
      try {
        const result = await replaceFrontImage(currentCard.item_id, file);
        setFrontImagePath(`images/library/${result.filename}`);
        setIsDirty(true);
      } catch (err) {
        setImageError(err.message || "Failed to replace front image");
      } finally {
        setReplacingFront(false);
      }
    } else {
      setReplacingBack(true);
      try {
        const result = await replaceBackImage(currentCard.item_id, file);
        setBackImagePath(`images/library/${result.filename}`);
        setIsDirty(true);
      } catch (err) {
        setImageError(err.message || "Failed to replace back image");
      } finally {
        setReplacingBack(false);
      }
    }
  }

  // Pure save — does not close modal; returns true on success, false on failure
  async function doSave() {
    setError("");
    if (selectedMemberIds.length === 0) {
      setError("Select at least one member.");
      return false;
    }
    setSaving(true);
    try {
      await updatePhotocard(currentCard.item_id, {
        topLevelCategoryId: Number(effectiveCategoryId),
        sourceOriginId: primary ? primary.source_origin_id : null,
        version: version.trim() || null,
        memberIds: selectedMemberIds.map(Number),
        isSpecial,
        secondaryOriginIds: secondaryTouched
          ? secondaryOrigins.map((o) => o.source_origin_id)
          : undefined,
      });
      setSecondaryTouched(false);
      setIsDirty(false);
      onSaved(); // notify parent to reload cards
      return true;
    } catch (err) {
      setError(err.message || "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Auto-close: save if dirty, then close. Used by X button and overlay click.
  async function handleAutoClose() {
    if (isDirty) {
      const ok = await doSave();
      if (!ok) return; // save failed — keep modal open with error shown
    } else if (copiesChanged) {
      onSaved();
    }
    onClose();
  }

  // Explicit Save button: save and close
  async function handleSaveAndClose() {
    if (isDirty) {
      const ok = await doSave();
      if (!ok) return;
    } else if (copiesChanged) {
      onSaved();
    }
    onClose();
  }

  // Cancel button: discard unsaved changes and close. Copy edits were
  // already persisted as the user made them, so we still notify the parent
  // to reload — otherwise the library view would show stale ownership.
  function handleCancel() {
    if (copiesChanged) onSaved();
    onClose();
  }

  // Navigate to prev/next card — auto-saves if dirty, flushes copy changes
  async function handleNavigate(delta) {
    const target = currentIndex + delta;
    if (target < 0 || target >= effectiveAllCards.length) return;
    if (isDirty) {
      const ok = await doSave();
      if (!ok) return; // save failed — stay on current card
    } else if (copiesChanged) {
      onSaved();
    }
    setCurrentIndex(target);
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deletePhotocard(currentCard.item_id);
      onDeleted(currentCard.item_id);
    } catch (err) {
      setError(err.message || "Failed to delete");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const groupName =
    groups.find((g) => g.group_id === currentCard.group_id)?.group_name || "—";

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < effectiveAllCards.length - 1;
  const showNav = effectiveAllCards.length > 1;

  const swipeHandlers = useSwipeNav({
    onPrev: () => hasPrev && !saving && handleNavigate(-1),
    onNext: () => hasNext && !saving && handleNavigate(1),
  });

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleAutoClose()}>
      <div style={styles.modal} {...swipeHandlers}>
        <div style={styles.modalHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {showNav && (
              <button
                style={{ ...styles.navBtn, opacity: hasPrev ? 1 : 0.3 }}
                onClick={() => handleNavigate(-1)}
                disabled={!hasPrev || saving}
                title="Previous card"
              >
                ‹
              </button>
            )}
            <span style={styles.modalTitle}>
              #{currentCard.item_id} — {groupName}
              {showNav && (
                <span style={styles.navCounter}> {currentIndex + 1}/{effectiveAllCards.length}</span>
              )}
            </span>
            {showNav && (
              <button
                style={{ ...styles.navBtn, opacity: hasNext ? 1 : 0.3 }}
                onClick={() => handleNavigate(1)}
                disabled={!hasNext || saving}
                title="Next card"
              >
                ›
              </button>
            )}
          </div>
          <button style={styles.closeBtn} onClick={handleAutoClose}>✕</button>
        </div>

        {(error || imageError) && (
          <div style={styles.errorBox}>{error || imageError}</div>
        )}

        <div style={styles.modalBody}>
          {/* Left: images */}
          <div style={styles.imagePanel}>
            <ImageSlot
              label="Front"
              path={frontImagePath}
              replacing={replacingFront}
              fileRef={frontFileRef}
              onFileChange={(file) => handleReplaceImage("front", file)}
            />
            <ImageSlot
              label="Back"
              path={backImagePath}
              replacing={replacingBack}
              fileRef={backFileRef}
              onFileChange={(file) => handleReplaceImage("back", file)}
            />
          </div>

          {/* Right: form */}
          <div style={styles.form}>
            {/* Group — read only, with card type toggle on right */}
            <FormRow label="Group">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={styles.readOnly}>{groupName}</span>
                <div style={{ display: "flex", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => { setIsSpecial(false); setIsDirty(true); }}
                    style={{
                      padding: "3px 9px",
                      fontSize: "var(--text-sm)",
                      cursor: "pointer",
                      border: "none",
                      borderRight: "1px solid var(--border-input)",
                      background: !isSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                      color: !isSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
                    }}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsSpecial(true); setIsDirty(true); }}
                    style={{
                      padding: "3px 9px",
                      fontSize: "var(--text-sm)",
                      cursor: "pointer",
                      border: "none",
                      background: isSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                      color: isSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
                    }}
                  >
                    ★ Special
                  </button>
                </div>
              </div>
            </FormRow>

            {/* Category — follows the primary source origin */}
            <FormRow label="Category">
              {primaryInfo ? (
                <div style={styles.readonlyValue} title="Set by the primary source origin (★)">
                  {effectiveCategoryName}
                </div>
              ) : (
                <select
                  value={topLevelCategoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  style={styles.select}
                >
                  {categories.map((c) => (
                    <option key={c.top_level_category_id} value={c.top_level_category_id}>
                      {c.category_name}
                    </option>
                  ))}
                </select>
              )}
            </FormRow>

            {/* Source Origins — ★ is the primary (sets the category, sort and
                captions; can't be removed, only replaced by starring another).
                The rest are "also in": the card shows up under each of them in
                the library filter, search and the card book without being
                duplicated. See docs/photocard_secondary_source_origins_plan.md */}
            <FormRow label="Source Origins">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {primaryInfo && (
                  <span
                    style={{ ...styles.chip, ...styles.chipPrimary }}
                    title="Primary source origin — sets the category"
                  >
                    <span style={styles.starOn} aria-hidden="true">★</span>
                    {primaryInfo.source_origin_name || `#${primaryInfo.source_origin_id}`}
                  </span>
                )}
                {secondaryOrigins.map((o) => (
                  <span key={o.source_origin_id} style={styles.chip} title={o.category_name || ""}>
                    <button
                      type="button"
                      style={styles.starBtn}
                      onClick={() => makePrimary(o)}
                      title="Make primary"
                      aria-label={`Make ${o.source_origin_name} the primary source origin`}
                    >
                      ☆
                    </button>
                    {o.source_origin_name}
                    <button
                      type="button"
                      style={styles.chipX}
                      onClick={() => removeSecondaryOrigin(o.source_origin_id)}
                      aria-label={`Remove ${o.source_origin_name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <OriginPicker
                  options={pickableOrigins}
                  categories={categories}
                  defaultCategoryId={effectiveCategoryId}
                  awayFromCategoryId={primaryInfo ? effectiveCategoryId : null}
                  onPick={addOrigin}
                  onCreate={createOrigin}
                />
              </div>
            </FormRow>

            {/* Version */}
            <FormRow label="Version">
              <input
                value={version}
                onChange={(e) => { setVersion(e.target.value); setIsDirty(true); }}
                placeholder="e.g. Soundwave POB"
                style={styles.input}
              />
            </FormRow>

            {/* Market — what the comps actually say, beside the price you would
                ask. Three separate rungs and never one word for two: cost is
                what it took to get, sell price is what it fetched, net proceeds
                is what was left after fees. */}
            <FormRow label="Market">
              {currentCard.market ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "baseline" }}>
                  <MarketFigure
                    label="cost"
                    cents={currentCard.market.cost_cents}
                    note={currentCard.market.cost_cents != null ? "estimate" : null}
                  />
                  {/* What one would cost you today. For a card that has never
                      sold but sits in a live lot this is the ONLY real figure,
                      which is why it earns a place beside the sell side. */}
                  <MarketFigure
                    label="buy"
                    cents={currentCard.market.buy_cents}
                    note={currentCard.market.buy_lot_size > 1
                      ? `in a ${currentCard.market.buy_lot_size}-card lot · ${usdc(currentCard.market.buy_landed_cents)} for all`
                      : currentCard.market.buy_marketplace_name}
                  />
                  <MarketFigure
                    label="sell price"
                    cents={currentCard.market.sell_price_cents}
                    note={currentCard.market.n_sold
                      ? `${currentCard.market.n_sold} sold`
                      : "no sales yet"}
                  />
                  <MarketFigure
                    label="net proceeds"
                    cents={currentCard.market.net_proceeds_cents}
                    note={currentCard.market.sell_marketplace_name
                      ? `after ${currentCard.market.sell_marketplace_name} fees`
                      : null}
                  />
                  {currentCard.market.n_active > 0 && (
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                      {currentCard.market.n_active} listed now
                    </span>
                  )}
                  {/* Client-side nav, not an anchor: the library's filters and
                      sort live in a module-level store, which a full page load
                      would reset -- so coming back would land on a different
                      list than the one you left. */}
                  <button
                    type="button"
                    onClick={() => navigate(`/market-intel?item=${currentCard.item_id}`)}
                    style={styles.marketLink}
                  >
                    Market detail →
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                  Nothing captured for this card yet.
                </span>
              )}
            </FormRow>

            {/* Members */}
            <FormRow label="Members">
              <div style={styles.memberGrid}>
                {members.map((m) => (
                  <label key={m.member_id} style={styles.memberChip}>
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.includes(String(m.member_id))}
                      onChange={() => toggleMember(m.member_id)}
                      style={{ marginRight: 4 }}
                    />
                    {m.member_name}
                  </label>
                ))}
              </div>
            </FormRow>

            {/* Copies */}
            <FormRow label="Copies">
              <CopiesTable
                copies={currentCard.copies || []}
                ownershipStatuses={ownershipStatuses}
                itemId={currentCard.item_id}
                onChanged={() => setCopiesChanged(true)}
              />
            </FormRow>
          </div>
        </div>

        <div style={styles.actions}>
          <div style={styles.actionsLeft}>
            {!confirmDelete ? (
              <button style={styles.deleteBtn} onClick={handleDelete}>
                Delete
              </button>
            ) : (
              <span style={styles.confirmPrompt}>
                Are you sure?{" "}
                <button style={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>{" "}
                <button style={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </span>
            )}
          </div>
          <div style={styles.actionsRight}>
            <button style={styles.cancelBtn} onClick={handleCancel}>
              Cancel
            </button>
            <button style={styles.saveBtn} onClick={handleSaveAndClose} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageSlot({ label, path, replacing, fileRef, onFileChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: "bold", color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{
        width: 130, height: 180,
        border: "1px solid var(--border-input)", borderRadius: "var(--radius-md)",
        background: "var(--bg-surface)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative",
      }}>
        {path ? (
          <img
            src={resolveCardSrc(path)}
            alt={label}
            loading="lazy"
            decoding="async"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>No {label.toLowerCase()}</span>
        )}
        {replacing && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-xs)", color: "var(--text-secondary)",
          }}>
            Uploading...
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChange(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        style={{ marginTop: 4, fontSize: "var(--text-xs)", padding: "2px 8px", cursor: "pointer", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", width: 130 }}
        onClick={() => fileRef.current?.click()}
        disabled={replacing}
      >
        {path ? "Replace" : "Upload"} {label}
      </button>
    </div>
  );
}

function CopiesTable({ copies: initialCopies, ownershipStatuses, itemId, onChanged }) {
  // Local optimistic state — parent reload is deferred until the user leaves
  // the card (so a filter-narrowing edit doesn't yank the modal away). Re-seed
  // when the card changes.
  const [copies, setCopies] = useState(initialCopies);
  useEffect(() => { setCopies(initialCopies); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [adding, setAdding] = useState(false);
  const [newOwnership, setNewOwnership] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [error, setError] = useState("");

  function statusName(id) {
    return ownershipStatuses.find((s) => s.ownership_status_id === Number(id))?.status_name || "";
  }

  async function handleAdd() {
    if (!newOwnership) return;
    setError("");
    try {
      const created = await createPhotocardCopy(itemId, {
        ownershipStatusId: Number(newOwnership),
        notes: newNotes.trim() || null,
      });
      setCopies((prev) => [
        ...prev,
        {
          copy_id: created.copy_id,
          ownership_status_id: Number(newOwnership),
          ownership_status: statusName(newOwnership),
          notes: newNotes.trim() || null,
          ...created,
        },
      ]);
      setAdding(false);
      setNewOwnership("");
      setNewNotes("");
      onChanged();
    } catch (err) {
      setError(err.message || "Failed to add copy");
    }
  }

  async function handleUpdate(copy, field, value) {
    setError("");
    const prev = copies;
    const next = copies.map((c) =>
      c.copy_id === copy.copy_id
        ? {
            ...c,
            ownership_status_id: field === "ownership" ? Number(value) : c.ownership_status_id,
            ownership_status: field === "ownership" ? statusName(value) : c.ownership_status,
            notes: field === "notes" ? (value.trim() || null) : c.notes,
          }
        : c
    );
    setCopies(next);
    try {
      await updatePhotocardCopy(itemId, copy.copy_id, {
        ownershipStatusId: field === "ownership" ? Number(value) : copy.ownership_status_id,
        notes: field === "notes" ? (value.trim() || null) : (copy.notes || null),
      });
      onChanged();
    } catch (err) {
      setCopies(prev); // rollback on failure
      setError(err.message || "Failed to update copy");
    }
  }

  async function handleDelete(copyId) {
    if (!window.confirm("Delete this copy?")) return;
    setError("");
    const prev = copies;
    setCopies(copies.filter((c) => c.copy_id !== copyId));
    try {
      await deletePhotocardCopy(itemId, copyId);
      onChanged();
    } catch (err) {
      setCopies(prev); // rollback on failure
      setError(err.message || "Failed to delete copy");
    }
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-input)" }}>
            <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: 600 }}>Ownership</th>
            <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: 600 }}>Notes</th>
            <th style={{ width: 28, padding: "3px 4px" }}></th>
          </tr>
        </thead>
        <tbody>
          {copies.map((cp) => (
            <tr key={cp.copy_id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "3px 4px" }}>
                <select
                  value={cp.ownership_status_id}
                  onChange={(e) => handleUpdate(cp, "ownership", e.target.value)}
                  style={{ fontSize: "var(--text-sm)", padding: "1px 2px" }}
                >
                  {ownershipStatuses.map((s) => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>
                      {s.status_name}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: "3px 4px" }}>
                <input
                  defaultValue={cp.notes || ""}
                  onBlur={(e) => {
                    if (e.target.value !== (cp.notes || "")) {
                      handleUpdate(cp, "notes", e.target.value);
                    }
                  }}
                  style={{ fontSize: "var(--text-sm)", width: "100%", border: "1px solid var(--border-input)", borderRadius: 2, padding: "1px 3px" }}
                />
              </td>
              <td style={{ padding: "3px 4px", textAlign: "center" }}>
                <button
                  onClick={() => handleDelete(cp.copy_id)}
                  style={{ background: "none", border: "none", color: "var(--danger-text)", cursor: "pointer", fontSize: "var(--text-md)", lineHeight: 1 }}
                  title="Delete copy"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {adding ? (
        <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          <select
            value={newOwnership}
            onChange={(e) => setNewOwnership(e.target.value)}
            style={{ fontSize: "var(--text-sm)", padding: "1px 2px", maxWidth: "100%" }}
          >
            <option value="">— Select —</option>
            {ownershipStatuses.map((s) => (
              <option key={s.ownership_status_id} value={s.ownership_status_id}>
                {s.status_name}
              </option>
            ))}
          </select>
          <input
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes"
            style={{ fontSize: "var(--text-sm)", flex: "1 1 120px", minWidth: 0, border: "1px solid var(--border-input)", borderRadius: 2, padding: "1px 3px" }}
          />
          <button onClick={handleAdd} style={{ fontSize: "var(--text-xs)", padding: "2px 8px", cursor: "pointer" }}>Add</button>
          <button onClick={() => setAdding(false)} style={{ fontSize: "var(--text-xs)", padding: "2px 8px", cursor: "pointer" }}>Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ marginTop: 4, fontSize: "var(--text-xs)", padding: "2px 8px", cursor: "pointer", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)" }}
        >
          + Add Copy
        </button>
      )}

      {error && <div style={{ color: "var(--danger-text)", fontSize: "var(--text-xs)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}


function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function primaryFromCard(card) {
  return card.source_origin_id
    ? {
        source_origin_id: card.source_origin_id,
        source_origin_name: card.source_origin,
        top_level_category_id: null, // resolved from groupOrigins once loaded
      }
    : null;
}

function sortByName(origins) {
  return [...origins].sort((a, b) =>
    (a.source_origin_name || "").localeCompare(b.source_origin_name || "")
  );
}

/** Bucket category-ordered origin rows for display. When `awayFromCategoryId`
 *  is set (the primary's category), the OTHER categories come first: the usual
 *  second origin is the opposite kind (album <-> tour), and listing the
 *  primary's own category first buried it below the fold. */
function groupOriginsByCategory(origins, awayFromCategoryId) {
  const groups = [];
  for (const o of origins) {
    const last = groups[groups.length - 1];
    if (last && last.id === o.top_level_category_id) last.items.push(o);
    else groups.push({ id: o.top_level_category_id, name: o.category_name, items: [o] });
  }
  if (awayFromCategoryId == null) return groups;
  const away = String(awayFromCategoryId);
  return [
    ...groups.filter((g) => String(g.id) !== away),
    ...groups.filter((g) => String(g.id) === away),
  ];
}

/** "+ Add" button opening a searchable list of the group's origins, grouped
 *  by category (rows arrive category-ordered from the endpoint), with
 *  "Create new origin…" at the bottom. */
function OriginPicker({ options, categories, defaultCategoryId, awayFromCategoryId, onPick, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState(defaultCategoryId);
  const [createError, setCreateError] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  function close() {
    setOpen(false);
    setQuery("");
    setCreating(false);
    setNewName("");
    setCreateError("");
  }

  // Close on a click anywhere outside the picker.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
        setCreating(false);
        setNewName("");
        setCreateError("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.source_origin_name.toLowerCase().includes(q))
    : options;
  const groups = groupOriginsByCategory(filtered, awayFromCategoryId);

  function pick(o) {
    onPick(o);
    close();
  }

  function startCreate() {
    setNewName(query.trim());
    setNewCategoryId(defaultCategoryId);
    setCreateError("");
    setCreating(true);
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name) {
      setCreateError("Enter a name.");
      return;
    }
    setBusy(true);
    setCreateError("");
    try {
      await onCreate(name, Number(newCategoryId));
      close();
    } catch (err) {
      setCreateError(err.message || "Failed to create source origin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span ref={wrapRef} style={styles.pickerWrap}>
      <button type="button" style={styles.addBtn} onClick={() => (open ? close() : setOpen(true))}>
        + Add
      </button>
      {open && (
        <div style={styles.pickerPanel}>
          {!creating ? (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.stopPropagation(); close(); }
                  if (e.key === "Enter" && filtered.length === 1) { e.preventDefault(); pick(filtered[0]); }
                }}
                placeholder="Search origins…"
                style={{ ...styles.input, marginBottom: 4 }}
              />
              <div style={styles.pickerList}>
                {groups.length === 0 && (
                  <div style={styles.pickerEmpty}>No matching origins</div>
                )}
                {groups.map((g) => (
                  <div key={g.id ?? "none"}>
                    <div style={styles.pickerGroup}>{g.name}</div>
                    {g.items.map((o) => (
                      <button
                        key={o.source_origin_id}
                        type="button"
                        style={styles.pickerItem}
                        onClick={() => pick(o)}
                      >
                        {o.source_origin_name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <button type="button" style={styles.pickerCreate} onClick={startCreate}>
                + Create new origin…
              </button>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.stopPropagation(); setCreating(false); }
                  if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
                }}
                placeholder="New source origin"
                style={styles.input}
              />
              <select
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                style={styles.select}
              >
                {categories.map((c) => (
                  <option key={c.top_level_category_id} value={c.top_level_category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
              {createError && <div style={styles.fieldError}>{createError}</div>}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button type="button" style={styles.cancelBtn} onClick={() => setCreating(false)}>
                  Back
                </button>
                <button type="button" style={styles.addBtn} onClick={submitCreate} disabled={busy}>
                  {busy ? "Saving…" : "Create"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

const styles = {
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 4px 2px 8px",
    fontSize: "var(--text-sm)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)",
  },
  chipX: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "var(--text-base)",
    lineHeight: 1,
    padding: "0 2px",
    color: "var(--text-muted)",
  },
  chipPrimary: {
    padding: "2px 8px",
    border: "1px solid var(--btn-primary-bg)",
    background: "var(--green-light)",
    fontWeight: 600,
  },
  starOn: {
    color: "var(--btn-primary-bg)",
    marginRight: 2,
  },
  starBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "var(--text-base)",
    lineHeight: 1,
    padding: "0 2px 0 0",
    color: "var(--text-muted)",
  },
  readonlyValue: {
    padding: "5px 0",
    fontSize: "var(--text-base)",
  },
  pickerWrap: {
    position: "relative",
    display: "inline-block",
  },
  pickerPanel: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 4,
    width: 260,
    maxWidth: "80vw",
    padding: 6,
    background: "var(--bg-base)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "var(--shadow-dropdown)",
    zIndex: 30,
  },
  pickerList: {
    maxHeight: 320,
    overflowY: "auto",
  },
  pickerGroup: {
    fontSize: "var(--text-xs)",
    color: "var(--text-muted)",
    fontWeight: 600,
    textTransform: "uppercase",
    padding: "6px 6px 2px",
  },
  pickerItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "4px 8px",
    fontSize: "var(--text-sm)",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-primary)",
  },
  pickerEmpty: {
    padding: "6px 8px",
    fontSize: "var(--text-sm)",
    color: "var(--text-muted)",
  },
  pickerCreate: {
    display: "block",
    width: "100%",
    textAlign: "left",
    marginTop: 4,
    padding: "5px 8px",
    fontSize: "var(--text-sm)",
    border: "none",
    borderTop: "1px solid var(--border)",
    background: "transparent",
    cursor: "pointer",
    color: "var(--btn-primary-bg)",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg-base)",
    borderRadius: "var(--radius-lg)",
    width: 700,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "var(--shadow-modal)",
  },
  modalBody: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  imagePanel: {
    flexShrink: 0,
    padding: "16px 12px 16px 16px",
    borderRight: "1px solid var(--border)",
    overflowY: "auto",
    background: "var(--bg-surface)",
    width: 158,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  },
  modalTitle: {
    fontWeight: "bold",
    fontSize: 15,
  },
  navBtn: {
    padding: "1px 7px",
    fontSize: "18px",
    lineHeight: 1,
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)",
  },
  navCounter: {
    fontSize: "var(--text-sm)",
    color: "var(--text-muted)",
    fontWeight: "normal",
    marginLeft: 4,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: "16px",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: "0 4px",
  },
  errorBox: {
    margin: "8px 16px 0",
    padding: "8px 10px",
    background: "var(--error-bg)",
    border: "1px solid var(--danger-text)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-base)",
    color: "var(--danger-text)",
  },
  form: {
    padding: "16px",
    overflowY: "auto",
    flex: 1,
    minWidth: 0,
  },
  readOnly: {
    fontSize: "var(--text-base)",
    color: "var(--text-primary)",
  },
  select: {
    width: "100%",
    padding: "5px 6px",
    fontSize: "var(--text-base)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
  },
  input: {
    width: "100%",
    padding: "5px 6px",
    fontSize: "var(--text-base)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "5px 6px",
    fontSize: "var(--text-base)",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    resize: "vertical",
    boxSizing: "border-box",
  },
  memberGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  memberChip: {
    display: "flex",
    alignItems: "center",
    fontSize: "var(--text-base)",
    cursor: "pointer",
    padding: "3px 6px",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)",
  },
  addBtn: {
    padding: "4px 8px",
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)",
    whiteSpace: "nowrap",
  },
  cancelBtn: {
    padding: "5px 12px",
    fontSize: "var(--text-base)",
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
  },
  saveBtn: {
    padding: "5px 16px",
    fontSize: "var(--text-base)",
    cursor: "pointer",
    border: "1px solid var(--btn-primary-bg)",
    borderRadius: "var(--radius-sm)",
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
    fontWeight: "bold",
  },
  deleteBtn: {
    padding: "5px 12px",
    fontSize: "var(--text-base)",
    cursor: "pointer",
    border: "1px solid var(--danger-text)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
    color: "var(--danger-text)",
  },
  marketLink: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--link-text, #2563eb)",
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    textDecoration: "underline",
  },
  fieldError: {
    color: "var(--danger-text)",
    fontSize: "var(--text-sm)",
    marginTop: 4,
  },
  confirmPrompt: {
    fontSize: "var(--text-base)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderTop: "1px solid var(--border)",
  },
  actionsLeft: {
    display: "flex",
    alignItems: "center",
  },
  actionsRight: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
};
