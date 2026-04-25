import { useEffect, useRef, useState } from "react";
import {
  fetchPhotocardMembers,
  fetchPhotocardSourceOrigins,
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

  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [members, setMembers] = useState([]);
  const [sourceOrigins, setSourceOrigins] = useState([]);

  // Form state — reset to currentCard values when card changes
  const [topLevelCategoryId, setTopLevelCategoryId] = useState(
    String(currentCard.top_level_category_id)
  );
  const [sourceOriginId, setSourceOriginId] = useState(
    currentCard.source_origin_id ? String(currentCard.source_origin_id) : ""
  );
  const [version, setVersion] = useState(currentCard.version || "");
  const [isSpecial, setIsSpecial] = useState(currentCard.is_special ?? true);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);

  const [showAddSourceOrigin, setShowAddSourceOrigin] = useState(false);
  const [newSourceOriginName, setNewSourceOriginName] = useState("");
  const [sourceOriginError, setSourceOriginError] = useState("");

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
    setSourceOriginId(currentCard.source_origin_id ? String(currentCard.source_origin_id) : "");
    setVersion(currentCard.version || "");
    setIsSpecial(currentCard.is_special ?? true);
    setSelectedMemberIds([]);
    setFrontImagePath(currentCard.front_image_path || null);
    setBackImagePath(currentCard.back_image_path || null);
    setIsDirty(false);
    setCopiesChanged(false);
    setError("");
    setImageError("");
    setConfirmDelete(false);
    setShowAddSourceOrigin(false);
    setNewSourceOriginName("");
    setSourceOriginError("");

    async function loadCardData() {
      try {
        const [memberData, soData] = await Promise.all([
          fetchPhotocardMembers(currentCard.group_id),
          fetchPhotocardSourceOrigins(currentCard.group_id, currentCard.top_level_category_id),
        ]);
        setMembers(memberData);
        setSourceOrigins(soData);

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

  // Explicit handler for category change — reloads source origins without a useEffect
  async function handleCategoryChange(newCatId) {
    setTopLevelCategoryId(newCatId);
    setIsDirty(true);
    try {
      const soData = await fetchPhotocardSourceOrigins(currentCard.group_id, newCatId);
      setSourceOrigins(soData);
      setSourceOriginId((prev) => {
        const ids = soData.map((o) => String(o.source_origin_id));
        return ids.includes(prev) ? prev : (soData.length ? String(soData[0].source_origin_id) : "");
      });
    } catch {
      // silently ignore
    }
  }

  async function handleCreateSourceOrigin() {
    setSourceOriginError("");
    const trimmed = newSourceOriginName.trim();
    if (!trimmed) {
      setSourceOriginError("Enter a name.");
      return;
    }
    try {
      const created = await createPhotocardSourceOrigin({
        groupId: currentCard.group_id,
        categoryId: Number(topLevelCategoryId),
        sourceOriginName: trimmed,
      });
      const refreshed = await fetchPhotocardSourceOrigins(
        currentCard.group_id,
        topLevelCategoryId
      );
      setSourceOrigins(refreshed);
      setSourceOriginId(String(created.source_origin_id));
      setNewSourceOriginName("");
      setShowAddSourceOrigin(false);
      setIsDirty(true);
    } catch (err) {
      setSourceOriginError(err.message || "Failed to create source origin");
    }
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
        topLevelCategoryId: Number(topLevelCategoryId),
        sourceOriginId: sourceOriginId ? Number(sourceOriginId) : null,
        version: version.trim() || null,
        memberIds: selectedMemberIds.map(Number),
        isSpecial,
      });
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

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && handleAutoClose()}>
      <div style={styles.modal}>
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

            {/* Category */}
            <FormRow label="Category">
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
            </FormRow>

            {/* Source Origin */}
            <FormRow label="Source Origin">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  value={sourceOriginId}
                  onChange={(e) => { setSourceOriginId(e.target.value); setIsDirty(true); }}
                  style={{ ...styles.select, flex: 1 }}
                >
                  <option value="">— None —</option>
                  {sourceOrigins.map((o) => (
                    <option key={o.source_origin_id} value={o.source_origin_id}>
                      {o.source_origin_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  style={styles.addBtn}
                  onClick={() => setShowAddSourceOrigin((p) => !p)}
                >
                  + Add
                </button>
              </div>
              {showAddSourceOrigin && (
                <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    value={newSourceOriginName}
                    onChange={(e) => setNewSourceOriginName(e.target.value)}
                    placeholder="New source origin"
                    style={{ ...styles.input, flex: 1 }}
                  />
                  <button type="button" style={styles.addBtn} onClick={handleCreateSourceOrigin}>
                    Save
                  </button>
                  <button type="button" style={styles.cancelBtn} onClick={() => setShowAddSourceOrigin(false)}>
                    Cancel
                  </button>
                </div>
              )}
              {sourceOriginError && <div style={styles.fieldError}>{sourceOriginError}</div>}
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

const styles = {
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
