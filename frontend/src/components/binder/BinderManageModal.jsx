import { useState } from "react";
import Modal from "../primitives/Modal";
import { createBinder, deleteBinder, updateBinder } from "../../api";
import { LAYOUTS, LAYOUT_CODES, DEFAULT_LAYOUT_CODE } from "./binderLayout";

/**
 * Create / rename / delete a binder.
 *
 * mode = "create" | "edit". Layout is only editable while a binder is empty —
 * the backend rejects a layout change on a binder holding cards rather than
 * guessing where those cards should land in a different pocket count.
 */
export default function BinderManageModal({ mode, binder, onClose, onSaved, onDeleted }) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(isEdit ? binder.binder_name : "");
  const [layoutCode, setLayoutCode] = useState(isEdit ? binder.layout_code : DEFAULT_LAYOUT_CODE);
  const [pageCount, setPageCount] = useState(10);
  const [notes, setNotes] = useState(isEdit ? binder.notes || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const layoutLocked = isEdit && (binder.placed_count ?? 0) > 0;

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Give the binder a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = isEdit
        ? await updateBinder(binder.binder_id, {
            binderName: name.trim(),
            notes: notes.trim(),
            ...(layoutLocked ? {} : { layoutCode }),
          })
        : await createBinder({
            binderName: name.trim(),
            layoutCode,
            pageCount: Number(pageCount) || 1,
            notes: notes.trim() || null,
          });
      onSaved(result);
    } catch (err) {
      setError(err.message || "Failed to save binder.");
      setBusy(false);
    }
  }

  async function handleDelete() {
    const held = binder.placed_count ?? 0;
    const warning = held
      ? `Delete "${binder.binder_name}"? ${held} card${held !== 1 ? "s" : ""} will return to the available list.`
      : `Delete "${binder.binder_name}"?`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    setError("");
    try {
      await deleteBinder(binder.binder_id);
      onDeleted(binder.binder_id);
    } catch (err) {
      setError(err.message || "Failed to delete binder.");
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      title={isEdit ? "Edit binder" : "New binder"}
      size="sm"
      footerJustify={isEdit ? "between" : "end"}
      footer={
        <>
          {isEdit && (
            <button type="button" style={styles.dangerBtn} onClick={handleDelete} disabled={busy}>
              Delete binder
            </button>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={styles.btn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" style={styles.primaryBtn} onClick={handleSubmit} disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </>
      }
    >
      {error && <div style={styles.error}>{error}</div>}

      <label style={styles.label}>Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Stray Kids — ATE"
        style={styles.input}
      />

      <label style={styles.label}>Pocket layout</label>
      <select
        value={layoutCode}
        onChange={(e) => setLayoutCode(e.target.value)}
        disabled={layoutLocked}
        style={styles.input}
      >
        {LAYOUT_CODES.map((code) => (
          <option key={code} value={code}>{LAYOUTS[code].label}</option>
        ))}
      </select>
      {layoutLocked && (
        <div style={styles.hint}>
          Remove all cards before changing the layout — a different pocket count
          has nowhere to put them.
        </div>
      )}

      {!isEdit && (
        <>
          <label style={styles.label}>Pages to start with</label>
          <input
            type="number"
            min={1}
            max={200}
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value)}
            style={styles.input}
          />
        </>
      )}

      <label style={styles.label}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        style={{ ...styles.input, resize: "vertical" }}
      />
    </Modal>
  );
}

const styles = {
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginTop: 10,
    marginBottom: 3,
  },
  input: {
    width: "100%",
    fontSize: "var(--text-base)",
    padding: "5px 7px",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    boxSizing: "border-box",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 4,
  },
  error: {
    padding: "8px 10px",
    marginBottom: 8,
    border: "1px solid var(--danger-text)",
    background: "var(--error-bg)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-sm)",
  },
  btn: {
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
  },
  primaryBtn: {
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "var(--btn-primary-bg)",
    color: "var(--btn-primary-text)",
  },
  dangerBtn: {
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--danger-text)",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--danger-text)",
  },
};
