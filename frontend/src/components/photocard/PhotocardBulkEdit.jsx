import { useEffect, useMemo, useState } from "react";
import {
  fetchPhotocardMembers,
  fetchOwnershipStatuses,
  bulkUpdatePhotocards,
  bulkDeletePhotocards,
} from "../../api";

/**
 * PhotocardBulkEdit — bulk edit panel for selected photocards.
 *
 * Constraints (matching original app behavior):
 *   - Ownership: always editable
 *   - Notes: always editable (set / append / clear)
 *   - Category: always editable
 *   - Version: editable only if all selected cards share the same group
 *   - Members: editable only if all selected cards share the same group
 *
 * Props:
 *   selectedCards  — array of photocard objects currently selected
 *   categories     — all categories array
 *   onClose        — callback()
 *   onSaved        — callback() — called after successful bulk update
 *   onDeleted      — callback() — called after successful bulk delete
 */
export default function PhotocardBulkEdit({
  selectedCards,
  categories,
  onClose,
  onSaved,
  onDeleted,
}) {
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [members, setMembers] = useState([]);

  // Field enable/values
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipStatusId, setOwnershipStatusId] = useState("");

  const [updateCategory, setUpdateCategory] = useState(false);
  const [topLevelCategoryId, setTopLevelCategoryId] = useState(
    categories[0] ? String(categories[0].top_level_category_id) : ""
  );

  const [notesAction, setNotesAction] = useState("set");
  const [updateNotes, setUpdateNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  const [updateVersion, setUpdateVersion] = useState(false);
  const [version, setVersion] = useState("");

  const [updateMembers, setUpdateMembers] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  // Determine if all selected cards share a single group
  const groupIds = [...new Set(selectedCards.map((c) => c.group_id))];
  const singleGroup = groupIds.length === 1;
  const sharedGroupId = singleGroup ? groupIds[0] : null;

  // Load ownership statuses + members (if single group)
  useEffect(() => {
    async function load() {
      try {
        const statusData = await fetchOwnershipStatuses();
        setOwnershipStatuses(statusData);
        if (statusData.length > 0) {
          setOwnershipStatusId(String(statusData[0].ownership_status_id));
        }
      } catch (err) {
        setError(err.message || "Failed to load statuses");
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!sharedGroupId) {
      setMembers([]);
      return;
    }
    fetchPhotocardMembers(sharedGroupId).then(setMembers).catch(() => {});
  }, [sharedGroupId]);

  function toggleMember(memberId) {
    const id = String(memberId);
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setError("");

    if (!updateOwnership && !updateCategory && !updateNotes && !updateVersion && !updateMembers) {
      setError("No fields selected to update.");
      return;
    }

    if (updateMembers && selectedMemberIds.length === 0) {
      setError("Select at least one member when updating members.");
      return;
    }

    const fields = {};

    if (updateOwnership) {
      fields.ownership_status_id = Number(ownershipStatusId);
    }
    if (updateCategory) {
      fields.top_level_category_id = Number(topLevelCategoryId);
    }
    if (updateNotes) {
      if (notesAction === "clear") {
        fields.notes_action = "clear";
      } else {
        fields.notes_action = notesAction;
        fields.notes = notesValue;
      }
    }
    if (updateVersion) {
      fields.version = version.trim() || null;
    }
    if (updateMembers) {
      fields.member_ids = selectedMemberIds.map(Number);
    }

    setSaving(true);
    try {
      const itemIds = selectedCards.map((c) => c.item_id);
      await bulkUpdatePhotocards(itemIds, fields);
      onSaved();
    } catch (err) {
      setError(err.message || "Failed to bulk update");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError("");
    setDeleting(true);
    try {
      const itemIds = selectedCards.map((c) => c.item_id);
      await bulkDeletePhotocards(itemIds);
      onDeleted();
    } catch (err) {
      setError(err.message || "Failed to delete cards");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Bulk Edit — {selectedCards.length} cards</span>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.body}>
        {/* Ownership */}
        <BulkRow
          label="Ownership"
          enabled={updateOwnership}
          onToggle={() => setUpdateOwnership((p) => !p)}
        >
          <select
            value={ownershipStatusId}
            onChange={(e) => setOwnershipStatusId(e.target.value)}
            style={styles.select}
            disabled={!updateOwnership}
          >
            {ownershipStatuses.map((s) => (
              <option key={s.ownership_status_id} value={s.ownership_status_id}>
                {s.status_name}
              </option>
            ))}
          </select>
        </BulkRow>

        {/* Category */}
        <BulkRow
          label="Category"
          enabled={updateCategory}
          onToggle={() => setUpdateCategory((p) => !p)}
        >
          <select
            value={topLevelCategoryId}
            onChange={(e) => setTopLevelCategoryId(e.target.value)}
            style={styles.select}
            disabled={!updateCategory}
          >
            {categories.map((c) => (
              <option key={c.top_level_category_id} value={c.top_level_category_id}>
                {c.category_name}
              </option>
            ))}
          </select>
        </BulkRow>

        {/* Notes */}
        <BulkRow
          label="Notes"
          enabled={updateNotes}
          onToggle={() => setUpdateNotes((p) => !p)}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["set", "append", "clear"].map((action) => (
              <label key={action} style={styles.radioLabel}>
                <input
                  type="radio"
                  name="notesAction"
                  value={action}
                  checked={notesAction === action}
                  onChange={() => setNotesAction(action)}
                  disabled={!updateNotes}
                  style={{ marginRight: 4 }}
                />
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </label>
            ))}
          </div>
          {notesAction !== "clear" && (
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={2}
              style={{ ...styles.textarea, marginTop: 6 }}
              disabled={!updateNotes}
              placeholder={notesAction === "append" ? "Text to append..." : "New notes..."}
            />
          )}
        </BulkRow>

        {/* Version — single group only */}
        <BulkRow
          label="Version"
          enabled={updateVersion && singleGroup}
          onToggle={() => singleGroup && setUpdateVersion((p) => !p)}
          disabled={!singleGroup}
          disabledReason="Requires all cards to be from the same group"
        >
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Version..."
            style={styles.input}
            disabled={!updateVersion || !singleGroup}
          />
        </BulkRow>

        {/* Members — single group only */}
        <BulkRow
          label="Members"
          enabled={updateMembers && singleGroup}
          onToggle={() => singleGroup && setUpdateMembers((p) => !p)}
          disabled={!singleGroup}
          disabledReason="Requires all cards to be from the same group"
        >
          <div style={styles.memberGrid}>
            {members.map((m) => (
              <label key={m.member_id} style={styles.memberChip}>
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(String(m.member_id))}
                  onChange={() => toggleMember(m.member_id)}
                  disabled={!updateMembers || !singleGroup}
                  style={{ marginRight: 4 }}
                />
                {m.member_name}
              </label>
            ))}
          </div>
        </BulkRow>
      </div>

      <div style={styles.footer}>
        <div style={styles.footerLeft}>
          {!confirmDelete ? (
            <button style={styles.deleteBtn} onClick={handleBulkDelete} disabled={deleting || saving}>
              Delete {selectedCards.length} cards
            </button>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ color: "#c62828", fontWeight: "bold" }}>Delete {selectedCards.length} cards?</span>
              <button style={styles.deleteBtn} onClick={handleBulkDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Yes"}
              </button>
              <button style={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.saveBtn} onClick={handleSave} disabled={saving || deleting}>
            {saving ? "Saving..." : `Apply to ${selectedCards.length} cards`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkRow({ label, enabled, onToggle, disabled, disabledReason, children }) {
  return (
    <div style={{ ...styles.row, opacity: disabled ? 0.5 : 1 }}>
      <label style={styles.rowHeader}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          disabled={disabled}
          style={{ marginRight: 8 }}
        />
        <span style={{ fontWeight: "bold", fontSize: 13 }}>{label}</span>
        {disabled && disabledReason && (
          <span style={styles.disabledNote}> — {disabledReason}</span>
        )}
      </label>
      {enabled && !disabled && (
        <div style={{ marginTop: 6, paddingLeft: 24 }}>{children}</div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: 6,
    width: 420,
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid #e0e0e0",
  },
  title: {
    fontWeight: "bold",
    fontSize: 14,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 15,
    cursor: "pointer",
    color: "#666",
    padding: "0 4px",
  },
  errorBox: {
    margin: "8px 14px 0",
    padding: "7px 10px",
    background: "#ffebee",
    border: "1px solid #c62828",
    borderRadius: 3,
    fontSize: 13,
    color: "#c62828",
  },
  body: {
    padding: "12px 14px",
    overflowY: "auto",
    flex: 1,
  },
  row: {
    marginBottom: 14,
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  disabledNote: {
    fontSize: 11,
    color: "#999",
    fontWeight: "normal",
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
  radioLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    cursor: "pointer",
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
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid #e0e0e0",
  },
  footerLeft: {
    display: "flex",
    alignItems: "center",
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
};
