// Guest-side bulk add: pick a status, apply to every selected catalog card.
//
// Each apply inserts a new row into guest_card_copies. We skip cards that
// already have a copy with the chosen status (no duplicates) and skip cards
// where the chosen status would create an Owned/Wanted conflict (mirrors the
// per-card detail-modal rule). The summary line shows what happened so the
// user knows nothing silent happened to the conflict cases.

import { useState } from "react";
import Modal from "../components/primitives/Modal";
import { addGuestCardCopy } from "./sqliteService";

const OWNED_CODE = "owned";
const WANTED_CODE = "wanted";
const CATALOG_CODE = "catalog";

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

  const [statusId, setStatusId] = useState(
    wantedDefault ? String(wantedDefault.ownership_status_id) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ownedId = pickable.find((s) => s.status_code === OWNED_CODE)?.ownership_status_id ?? null;
  const wantedId = pickable.find((s) => s.status_code === WANTED_CODE)?.ownership_status_id ?? null;

  async function handleApply() {
    setError("");
    const sid = Number(statusId);
    if (!sid) {
      setError("Pick a status to apply.");
      return;
    }

    let added = 0;
    let skippedDuplicate = 0;
    let skippedConflict = 0;
    let skippedNoCatalogId = 0;
    const failed = [];

    setBusy(true);
    try {
      for (const card of selectedCards) {
        if (!card.catalog_item_id) {
          skippedNoCatalogId++;
          continue;
        }
        const realCopies = (card.copies || []).filter((c) => c.copy_id != null);
        const hasSame = realCopies.some((c) => c.ownership_status_id === sid);
        if (hasSame) {
          skippedDuplicate++;
          continue;
        }
        const conflicts =
          (sid === ownedId && realCopies.some((c) => c.ownership_status_id === wantedId)) ||
          (sid === wantedId && realCopies.some((c) => c.ownership_status_id === ownedId));
        if (conflicts) {
          skippedConflict++;
          continue;
        }
        try {
          await addGuestCardCopy({
            catalogItemId: card.catalog_item_id,
            ownershipStatusId: sid,
          });
          added++;
        } catch (err) {
          failed.push(err?.message || String(err));
        }
      }
    } finally {
      setBusy(false);
    }

    const parts = [`Added ${added}`];
    if (skippedDuplicate) parts.push(`${skippedDuplicate} already had this status`);
    if (skippedConflict) parts.push(`${skippedConflict} had Owned/Wanted conflict`);
    if (skippedNoCatalogId) parts.push(`${skippedNoCatalogId} missing catalog ID`);
    if (failed.length) parts.push(`${failed.length} failed`);

    onSaved(parts.join(" · "));
  }

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        style={cancelBtn}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleApply}
        disabled={busy || !statusId}
        style={primaryBtn}
      >
        {busy ? "Applying…" : `Apply to ${selectedCards.length} cards`}
      </button>
    </>
  );

  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      size="sm"
      title={`Bulk add — ${selectedCards.length} cards`}
      footer={footer}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <div style={{ color: "var(--text-muted)" }}>
          Add a copy of each selected card with the chosen status.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {pickable.map((s) => {
            const sel = String(s.ownership_status_id) === statusId;
            return (
              <button
                key={s.ownership_status_id}
                type="button"
                onClick={() => setStatusId(String(s.ownership_status_id))}
                disabled={busy}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  borderRadius: 4,
                  border: sel
                    ? "1px solid var(--btn-primary-bg)"
                    : "1px solid var(--border-input)",
                  background: sel ? "var(--btn-primary-bg)" : "var(--bg-base)",
                  color: sel ? "var(--btn-primary-text)" : "var(--text-primary)",
                  fontWeight: sel ? 600 : 400,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {s.status_name}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Cards that already have this status, or have an Owned/Wanted conflict,
          will be skipped.
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 10px",
              background: "var(--error-bg, #fde8e8)",
              color: "var(--danger-text, #c00)",
              border: "1px solid var(--danger-text, #c00)",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

const primaryBtn = {
  padding: "5px 16px",
  fontSize: "var(--text-base)",
  cursor: "pointer",
  border: "1px solid var(--btn-primary-bg)",
  borderRadius: "var(--radius-sm)",
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-text)",
  fontWeight: "bold",
};

const cancelBtn = {
  padding: "5px 12px",
  fontSize: "var(--text-base)",
  cursor: "pointer",
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-base)",
};
