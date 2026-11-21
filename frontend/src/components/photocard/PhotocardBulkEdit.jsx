import { useEffect, useMemo, useState } from "react";
import {
  fetchPhotocardMembers,
  fetchPhotocardSourceOrigins,
  fetchPhotocardGroupOrigins,
  fetchOwnershipStatuses,
  bulkUpdatePhotocards,
  bulkDeletePhotocards,
} from "../../api";
import { COLLECTION_TYPE_IDS } from "../../constants/collectionTypes";
import { Modal } from "../primitives";

/**
 * PhotocardBulkEdit — bulk edit panel for selected photocards.
 *
 * Constraints (matching original app behavior):
 *   - Ownership: always editable
 *   - Notes: always editable (set / append / clear)
 *   - Category: always editable
 *   - Version: editable only if all selected cards share the same group
 *   - Members: editable only if all selected cards share the same group
 *   - Also in (secondary origins): add or remove one origin; single group only,
 *     but categories may be mixed -- secondaries cross categories on purpose
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

  const [updateSourceOrigin, setUpdateSourceOrigin] = useState(false);
  const [sourceOrigins, setSourceOrigins] = useState([]);
  const [sourceOriginId, setSourceOriginId] = useState("0");

  const [updateIsSpecial, setUpdateIsSpecial] = useState(false);
  const [bulkIsSpecial, setBulkIsSpecial] = useState(false);

  // Secondary origins: add/remove ONE origin across the selection. Add/remove
  // rather than replace -- the selected cards may hold different secondaries.
  const [updateSecondary, setUpdateSecondary] = useState(false);
  const [secondaryAction, setSecondaryAction] = useState("add"); // "add" | "remove"
  const [secondaryOriginId, setSecondaryOriginId] = useState("");
  const [groupOrigins, setGroupOrigins] = useState([]);


  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  // Determine if all selected cards share a single group and single category
  const groupIds = [...new Set(selectedCards.map((c) => c.group_id))];
  const singleGroup = groupIds.length === 1;
  const sharedGroupId = singleGroup ? groupIds[0] : null;

  const categoryIds = [...new Set(selectedCards.map((c) => c.top_level_category_id))];
  const singleCategory = categoryIds.length === 1;
  const sharedCategoryId = singleCategory ? categoryIds[0] : null;

  const canEditSourceOrigin = singleGroup && singleCategory;

  // Load ownership statuses + members (if single group)
  useEffect(() => {
    async function load() {
      try {
        const statusData = await fetchOwnershipStatuses(COLLECTION_TYPE_IDS.photocards);
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

  useEffect(() => {
    if (!canEditSourceOrigin) {
      setSourceOrigins([]);
      setSourceOriginId("0");
      return;
    }
    fetchPhotocardSourceOrigins(sharedGroupId, sharedCategoryId)
      .then(setSourceOrigins)
      .catch(() => {});
  }, [canEditSourceOrigin, sharedGroupId, sharedCategoryId]);

  useEffect(() => {
    if (!sharedGroupId) {
      setGroupOrigins([]);
      return;
    }
    fetchPhotocardGroupOrigins(sharedGroupId).then(setGroupOrigins).catch(() => {});
  }, [sharedGroupId]);

  // Remove offers only origins some selected card actually holds as a
  // secondary; Add offers every origin in the group.
  const secondaryOptions = useMemo(() => {
    if (secondaryAction === "add") return groupOrigins;
    const held = new Set(
      selectedCards.flatMap((c) => (c.secondary_origins || []).map((o) => o.source_origin_id))
    );
    return groupOrigins.filter((o) => held.has(o.source_origin_id));
  }, [secondaryAction, groupOrigins, selectedCards]);

  useEffect(() => {
    if (!secondaryOptions.some((o) => String(o.source_origin_id) === secondaryOriginId)) {
      setSecondaryOriginId("");
    }
  }, [secondaryOptions, secondaryOriginId]);

  function toggleMember(memberId) {
    const id = String(memberId);
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    setError("");

    const doSecondary = updateSecondary && singleGroup;
    if (!updateOwnership && !updateCategory && !updateVersion && !updateMembers && !updateSourceOrigin && !updateIsSpecial && !doSecondary) {
      setError("No fields selected to update.");
      return;
    }

    if (doSecondary && !secondaryOriginId) {
      setError("Choose an origin for Also in.");
      return;
    }

    if (updateMembers && selectedMemberIds.length === 0) {
      setError("Select at least one member when updating members.");
      return;
    }

    // Mixed-status warning for ownership bulk update
    if (updateOwnership) {
      const mixedCards = selectedCards.filter((c) => {
        const statuses = new Set((c.copies || []).map((cp) => cp.ownership_status_id));
        return statuses.size > 1;
      });
      if (mixedCards.length > 0) {
        const statusName = ownershipStatuses.find((s) => String(s.ownership_status_id) === ownershipStatusId)?.status_name || ownershipStatusId;
        const ok = window.confirm(
          `${mixedCards.length} of the selected cards have copies with mixed ownership statuses. Setting ownership to "${statusName}" will update ALL copies of those cards. Continue?`
        );
        if (!ok) return;
      }
    }

    const fields = {};

    if (updateOwnership) {
      fields.ownership_status_id = Number(ownershipStatusId);
    }
    if (updateCategory) {
      fields.top_level_category_id = Number(topLevelCategoryId);
    }
    if (updateVersion) {
      fields.version = version.trim() || null;
    }
    if (updateMembers) {
      fields.member_ids = selectedMemberIds.map(Number);
    }
    if (updateSourceOrigin) {
      fields.source_origin_id = Number(sourceOriginId); // 0 = clear to NULL
    }
    if (updateIsSpecial) {
      fields.is_special = bulkIsSpecial;
    }
    if (doSecondary) {
      const key = secondaryAction === "add" ? "secondary_origins_add" : "secondary_origins_remove";
      fields[key] = [Number(secondaryOriginId)];
    }

    setSaving(true);
    try {
      const itemIds = selectedCards.map((c) => c.item_id);
      const result = await bulkUpdatePhotocards(itemIds, fields);
      const skipped = result?.secondary_origins?.skipped || 0;
      if (skipped > 0) {
        // Not an error: those cards already have this origin as their primary.
        window.alert(
          `Also in: added to ${result.secondary_origins.added} card(s). ` +
          `${skipped} skipped because it is already their source origin.`
        );
      }
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

  const footer = (
    <div style={styles.footer}>
      <div style={styles.footerLeft}>
        {!confirmDelete ? (
          <button style={styles.deleteBtn} onClick={handleBulkDelete} disabled={deleting || saving}>
            Delete {selectedCards.length} cards
          </button>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-base)", flexWrap: "wrap" }}>
            <span style={{ color: "var(--danger-text)", fontWeight: "bold" }}>Delete {selectedCards.length} cards?</span>
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
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Bulk Edit — ${selectedCards.length} cards`}
      footer={footer}
      footerJustify="between"
    >
      {error && <div style={styles.errorBox}>{error}</div>}

      <div style={styles.body}>
        {/* Card Type — first, as on the card modal (beside Group) */}
        <BulkRow
          label="Card Type"
          enabled={updateIsSpecial}
          onToggle={() => setUpdateIsSpecial((p) => !p)}
        >
          <div style={{ display: "flex", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", width: "fit-content" }}>
            <button
              type="button"
              onClick={() => setBulkIsSpecial(false)}
              style={{
                padding: "3px 10px",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
                border: "none",
                borderRight: "1px solid var(--border-input)",
                background: !bulkIsSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                color: !bulkIsSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
              }}
            >
              Regular
            </button>
            <button
              type="button"
              onClick={() => setBulkIsSpecial(true)}
              style={{
                padding: "3px 10px",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
                border: "none",
                background: bulkIsSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                color: bulkIsSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
              }}
            >
              ★ Special
            </button>
          </div>
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

        {/* Source Origin — requires single group + single category */}
        <BulkRow
          label="Source Origin"
          enabled={updateSourceOrigin && canEditSourceOrigin}
          onToggle={() => canEditSourceOrigin && setUpdateSourceOrigin((p) => !p)}
          disabled={!canEditSourceOrigin}
          disabledReason="Requires all cards to share the same group and category"
        >
          <select
            value={sourceOriginId}
            onChange={(e) => setSourceOriginId(e.target.value)}
            style={styles.select}
            disabled={!updateSourceOrigin}
          >
            <option value="0">— None —</option>
            {sourceOrigins.map((o) => (
              <option key={o.source_origin_id} value={o.source_origin_id}>
                {o.source_origin_name}
              </option>
            ))}
          </select>
        </BulkRow>

        {/* Also in (secondary origins) — single group, any categories */}
        <BulkRow
          label="Also in"
          enabled={updateSecondary && singleGroup}
          onToggle={() => singleGroup && setUpdateSecondary((p) => !p)}
          disabled={!singleGroup}
          disabledReason="Requires all cards to be from the same group"
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", width: "fit-content" }}>
              {["add", "remove"].map((action, i) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => setSecondaryAction(action)}
                  style={{
                    padding: "3px 10px",
                    fontSize: "var(--text-sm)",
                    cursor: "pointer",
                    border: "none",
                    borderRight: i === 0 ? "1px solid var(--border-input)" : "none",
                    background: secondaryAction === action ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                    color: secondaryAction === action ? "var(--btn-primary-text)" : "var(--text-primary)",
                  }}
                >
                  {action === "add" ? "Add" : "Remove"}
                </button>
              ))}
            </div>
            <select
              value={secondaryOriginId}
              onChange={(e) => setSecondaryOriginId(e.target.value)}
              style={{ ...styles.select, width: "auto", flex: 1, minWidth: 140 }}
            >
              <option value="">
                {secondaryOptions.length ? "— Choose origin —" : "— None on these cards —"}
              </option>
              {groupByCategory(secondaryOptions, sharedCategoryId).map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.items.map((o) => (
                    <option key={o.source_origin_id} value={o.source_origin_id}>
                      {o.source_origin_name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={styles.hint}>
            Cards show up under this origin too, without being duplicated.
          </div>
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

        {/* Ownership — last, matching the card modal where Copies close the form */}
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

      </div>
    </Modal>
  );
}

/** Rows arrive ordered by category from the endpoint; bucket them for
 *  <optgroup>. With `awayFromCategoryId` (the selection's shared category) the
 *  OTHER categories come first -- the usual "also in" is the opposite kind
 *  (album <-> tour), and listing the cards' own category first buried it. */
function groupByCategory(origins, awayFromCategoryId) {
  const out = [];
  for (const o of origins) {
    const last = out[out.length - 1];
    if (last && last.id === o.top_level_category_id) last.items.push(o);
    else out.push({ id: o.top_level_category_id, name: o.category_name, items: [o] });
  }
  if (awayFromCategoryId == null) return out;
  const away = String(awayFromCategoryId);
  return [
    ...out.filter((g) => String(g.id) !== away),
    ...out.filter((g) => String(g.id) === away),
  ];
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
  errorBox: {
    marginBottom: 10,
    padding: "7px 10px",
    background: "var(--error-bg)",
    border: "1px solid var(--danger-text)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-base)",
    color: "var(--danger-text)",
  },
  body: {
    display: "flex",
    flexDirection: "column",
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
    fontSize: "var(--text-xs)",
    color: "var(--text-muted)",
    fontWeight: "normal",
  },
  hint: {
    fontSize: "var(--text-xs)",
    color: "var(--text-muted)",
    marginTop: 3,
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
  radioLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: "var(--text-base)",
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
    fontSize: "var(--text-base)",
    cursor: "pointer",
    padding: "3px 6px",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    width: "100%",
    flexWrap: "wrap",
  },
  footerLeft: {
    display: "flex",
    alignItems: "center",
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
};
