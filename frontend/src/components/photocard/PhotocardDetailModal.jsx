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
} from "../../api";
import { API_BASE } from "../../utils/imageUrl";

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
  const [ownershipStatusId, setOwnershipStatusId] = useState(
    String(currentCard.ownership_status_id)
  );
  const [sourceOriginId, setSourceOriginId] = useState(
    currentCard.source_origin_id ? String(currentCard.source_origin_id) : ""
  );
  const [version, setVersion] = useState(currentCard.version || "");
  const [notes, setNotes] = useState(currentCard.notes || "");
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
    const HIDDEN = new Set(["Formerly Owned", "Borrowed"]);
    fetchOwnershipStatuses()
      .then(all => setOwnershipStatuses(all.filter(s => !HIDDEN.has(s.status_name))))
      .catch(() => {});
  }, []);

  // Reset form and reload per-card data whenever the current card changes
  useEffect(() => {
    setTopLevelCategoryId(String(currentCard.top_level_category_id));
    setOwnershipStatusId(String(currentCard.ownership_status_id));
    setSourceOriginId(currentCard.source_origin_id ? String(currentCard.source_origin_id) : "");
    setVersion(currentCard.version || "");
    setNotes(currentCard.notes || "");
    setIsSpecial(currentCard.is_special ?? true);
    setSelectedMemberIds([]);
    setFrontImagePath(currentCard.front_image_path || null);
    setBackImagePath(currentCard.back_image_path || null);
    setIsDirty(false);
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
        ownershipStatusId: Number(ownershipStatusId),
        notes: notes.trim() || null,
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
    }
    onClose();
  }

  // Explicit Save button: save and close
  async function handleSaveAndClose() {
    const ok = await doSave();
    if (ok) onClose();
  }

  // Cancel button: discard unsaved changes and close
  function handleCancel() {
    onClose();
  }

  // Navigate to prev/next card — auto-saves if dirty
  async function handleNavigate(delta) {
    const target = currentIndex + delta;
    if (target < 0 || target >= effectiveAllCards.length) return;
    if (isDirty) {
      const ok = await doSave();
      if (!ok) return; // save failed — stay on current card
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
                <div style={{ display: "flex", border: "1px solid #ccc", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => { setIsSpecial(false); setIsDirty(true); }}
                    style={{
                      padding: "3px 9px",
                      fontSize: 12,
                      cursor: "pointer",
                      border: "none",
                      borderRight: "1px solid #ccc",
                      background: !isSpecial ? "#1565c0" : "#f5f5f5",
                      color: !isSpecial ? "#fff" : "#333",
                    }}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsSpecial(true); setIsDirty(true); }}
                    style={{
                      padding: "3px 9px",
                      fontSize: 12,
                      cursor: "pointer",
                      border: "none",
                      background: isSpecial ? "#1565c0" : "#f5f5f5",
                      color: isSpecial ? "#fff" : "#333",
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

            {/* Ownership */}
            <FormRow label="Ownership">
              <select
                value={ownershipStatusId}
                onChange={(e) => { setOwnershipStatusId(e.target.value); setIsDirty(true); }}
                style={styles.select}
              >
                {ownershipStatuses.map((s) => (
                  <option key={s.ownership_status_id} value={s.ownership_status_id}>
                    {s.status_name}
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

            {/* Notes */}
            <FormRow label="Notes">
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setIsDirty(true); }}
                rows={3}
                style={styles.textarea}
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
      <div style={{ fontSize: 11, fontWeight: "bold", color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{
        width: 130, height: 180,
        border: "1px solid #ddd", borderRadius: 4,
        background: "#f0f0f0",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative",
      }}>
        {path ? (
          <img
            src={`${API_BASE}/images/library/${path.replace(/^.*[\\/]/, "")}?v=${Date.now()}`}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 11, color: "#aaa" }}>No {label.toLowerCase()}</span>
        )}
        {replacing && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#555",
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
        style={{ marginTop: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#f5f5f5", width: 130 }}
        onClick={() => fileRef.current?.click()}
        disabled={replacing}
      >
        {path ? "Replace" : "Upload"} {label}
      </button>
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#555", marginBottom: 4 }}>
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
    background: "#fff",
    borderRadius: 6,
    width: 700,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
  },
  modalBody: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  imagePanel: {
    flexShrink: 0,
    padding: "16px 12px 16px 16px",
    borderRight: "1px solid #e0e0e0",
    overflowY: "auto",
    background: "#fafafa",
    width: 158,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid #e0e0e0",
  },
  modalTitle: {
    fontWeight: "bold",
    fontSize: 15,
  },
  navBtn: {
    padding: "1px 7px",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: 3,
    background: "#f5f5f5",
  },
  navCounter: {
    fontSize: 12,
    color: "#888",
    fontWeight: "normal",
    marginLeft: 4,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 16,
    cursor: "pointer",
    color: "#666",
    padding: "0 4px",
  },
  errorBox: {
    margin: "8px 16px 0",
    padding: "8px 10px",
    background: "#ffebee",
    border: "1px solid #c62828",
    borderRadius: 3,
    fontSize: 13,
    color: "#c62828",
  },
  form: {
    padding: "16px",
    overflowY: "auto",
    flex: 1,
    minWidth: 0,
  },
  readOnly: {
    fontSize: 13,
    color: "#333",
  },
  select: {
    width: "100%",
    padding: "5px 6px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 3,
  },
  input: {
    width: "100%",
    padding: "5px 6px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 3,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    padding: "5px 6px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 3,
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
    fontSize: 13,
    cursor: "pointer",
    padding: "3px 6px",
    border: "1px solid #ddd",
    borderRadius: 3,
    background: "#f9f9f9",
  },
  addBtn: {
    padding: "4px 8px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: 3,
    background: "#f5f5f5",
    whiteSpace: "nowrap",
  },
  cancelBtn: {
    padding: "5px 12px",
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: 3,
    background: "#fff",
  },
  saveBtn: {
    padding: "5px 16px",
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #1565c0",
    borderRadius: 3,
    background: "#1565c0",
    color: "#fff",
    fontWeight: "bold",
  },
  deleteBtn: {
    padding: "5px 12px",
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #c62828",
    borderRadius: 3,
    background: "#fff",
    color: "#c62828",
  },
  fieldError: {
    color: "#c62828",
    fontSize: 12,
    marginTop: 4,
  },
  confirmPrompt: {
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderTop: "1px solid #e0e0e0",
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
