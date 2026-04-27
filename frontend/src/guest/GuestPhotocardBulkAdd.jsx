// Guest-side bulk update: change every selected card's ownership status
// (and optionally notes) in one operation.
//
// Two-step flow: pick status (+ notes) → confirm → apply. The confirm step
// is required so a default of "Wanted" can't silently move a batch of
// owned/traded cards. Action buttons live inside the modal body (not the
// footer slot) so they stay visible on iOS Safari, where the system
// toolbar can otherwise clip the .cc-modal__footer at the viewport edge.
//
// Per-card semantics:
//   - 0 real copies → insert one with the chosen status
//   - 1+ real copies → update every existing copy on that card to the
//     chosen status (so the card lands at exactly that one status)
//   - notes: only touched when the "Also update notes" checkbox is on.
//     Empty string = clear; non-empty = set verbatim.

import { useState } from "react";
import Modal from "../components/primitives/Modal";
import {
  addGuestCardCopy,
  updateGuestCardCopy,
} from "./sqliteService";

const CATALOG_CODE = "catalog";
const WANTED_CODE = "wanted";

export default function GuestPhotocardBulkAdd({
  selectedCards,
  ownershipStatuses,
  onClose,
  onSaved,
}) {
  const pickable = (ownershipStatuses || []).filter(
    (s) => s.status_code !== CATALOG_CODE,
  );
  const wantedDefault =
    pickable.find((s) => s.status_code === WANTED_CODE) || pickable[0];

  const [step, setStep] = useState("form"); // "form" | "confirm"
  const [statusId, setStatusId] = useState(
    wantedDefault ? String(wantedDefault.ownership_status_id) : "",
  );
  const [updateNotes, setUpdateNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedStatusName =
    pickable.find((s) => String(s.ownership_status_id) === statusId)?.status_name || "";

  function goReview() {
    setError("");
    if (!statusId) {
      setError("Pick a status to apply.");
      return;
    }
    setStep("confirm");
  }

  async function handleConfirm() {
    setBusy(true);
    setError("");

    let updated = 0;
    let added = 0;
    let skippedNoCatalogId = 0;
    let failed = 0;

    const sid = Number(statusId);
    const notesNext = updateNotes ? (notesValue.trim() || null) : undefined;

    try {
      for (const card of selectedCards) {
        if (!card.catalog_item_id) {
          skippedNoCatalogId++;
          continue;
        }
        const realCopies = (card.copies || []).filter((c) => c.copy_id != null);
        try {
          if (realCopies.length === 0) {
            await addGuestCardCopy({
              catalogItemId: card.catalog_item_id,
              ownershipStatusId: sid,
              notes: notesNext === undefined ? null : notesNext,
            });
            added++;
          } else {
            for (const c of realCopies) {
              const fields = { ownershipStatusId: sid };
              if (notesNext !== undefined) fields.notes = notesNext;
              await updateGuestCardCopy(c.copy_id, fields);
            }
            updated++;
          }
        } catch (err) {
          console.error("[bulk-update] card failed", card.item_id, err);
          failed++;
        }
      }
    } finally {
      setBusy(false);
    }

    const parts = [];
    if (updated) parts.push(`${updated} updated`);
    if (added) parts.push(`${added} added`);
    if (skippedNoCatalogId) parts.push(`${skippedNoCatalogId} skipped (no catalog ID)`);
    if (failed) parts.push(`${failed} failed`);
    onSaved(parts.length ? parts.join(" · ") : "No changes applied.");
  }

  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      size="sm"
      title={`Bulk Update — ${selectedCards.length} cards`}
    >
      {step === "form" ? (
        <FormStep
          pickable={pickable}
          statusId={statusId}
          setStatusId={setStatusId}
          updateNotes={updateNotes}
          setUpdateNotes={setUpdateNotes}
          notesValue={notesValue}
          setNotesValue={setNotesValue}
          error={error}
          onCancel={onClose}
          onReview={goReview}
        />
      ) : (
        <ConfirmStep
          count={selectedCards.length}
          statusName={selectedStatusName}
          updateNotes={updateNotes}
          notesValue={notesValue}
          busy={busy}
          error={error}
          onBack={() => setStep("form")}
          onConfirm={handleConfirm}
        />
      )}
    </Modal>
  );
}

function FormStep({
  pickable,
  statusId,
  setStatusId,
  updateNotes,
  setUpdateNotes,
  notesValue,
  setNotesValue,
  error,
  onCancel,
  onReview,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
      <div>
        <div style={labelStyle}>Set status to</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {pickable.map((s) => {
            const sel = String(s.ownership_status_id) === statusId;
            return (
              <button
                key={s.ownership_status_id}
                type="button"
                onClick={() => setStatusId(String(s.ownership_status_id))}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  borderRadius: 4,
                  border: sel
                    ? "1px solid var(--btn-primary-bg)"
                    : "1px solid var(--border-input)",
                  background: sel ? "var(--btn-primary-bg)" : "var(--bg-base)",
                  color: sel ? "var(--btn-primary-text)" : "var(--text-primary)",
                  fontWeight: sel ? 600 : 400,
                  cursor: "pointer",
                  minHeight: 36,
                }}
              >
                {s.status_name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={updateNotes}
            onChange={(e) => setUpdateNotes(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>Also update notes</span>
        </label>
        {updateNotes && (
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            placeholder="Notes to apply to every selected card (leave empty to clear)"
            rows={3}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 13,
              border: "1px solid var(--border-input)",
              borderRadius: 4,
              boxSizing: "border-box",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        )}
      </div>

      {error && (
        <div role="alert" style={errorStyle}>{error}</div>
      )}

      <div style={actionRow}>
        <button type="button" onClick={onCancel} style={cancelBtn}>
          Cancel
        </button>
        <button type="button" onClick={onReview} style={primaryBtn}>
          Review →
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({ count, statusName, updateNotes, notesValue, busy, error, onBack, onConfirm }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        Apply the following changes to <strong>{count}</strong>{" "}
        {count === 1 ? "card" : "cards"}?
      </div>

      <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>
          Set status to <strong>{statusName}</strong>
        </li>
        {updateNotes && (
          <li>
            Set notes to{" "}
            {notesValue.trim()
              ? <em>"{notesValue.trim()}"</em>
              : <em>(empty)</em>}
          </li>
        )}
      </ul>

      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Cards already at this status will be left as-is. Cards with multiple
        existing copies will all be set to this status.
      </div>

      {error && (
        <div role="alert" style={errorStyle}>{error}</div>
      )}

      <div style={actionRow}>
        <button type="button" onClick={onBack} disabled={busy} style={cancelBtn}>
          ← Back
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} style={primaryBtn}>
          {busy ? "Applying…" : `Confirm — update ${count}`}
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
};

const actionRow = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 4,
};

const primaryBtn = {
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid var(--btn-primary-bg)",
  borderRadius: 4,
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-text)",
  fontWeight: 700,
  minHeight: 40,
};

const cancelBtn = {
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid var(--border-input)",
  borderRadius: 4,
  background: "var(--bg-base)",
  minHeight: 40,
};

const errorStyle = {
  padding: "8px 10px",
  background: "var(--error-bg, #fde8e8)",
  color: "var(--danger-text, #c00)",
  border: "1px solid var(--danger-text, #c00)",
  borderRadius: 4,
  fontSize: 13,
};
