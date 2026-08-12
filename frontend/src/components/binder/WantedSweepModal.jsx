import { useMemo, useState } from "react";
import Modal from "../primitives/Modal";
import { bulkUpdatePhotocards, createPhotocardCopy } from "../../api";

/**
 * Offer to mark placed-but-uncollected cards as Wanted, after a binder save.
 *
 * Opt-in, never automatic — designing a page is planning, and planning a card
 * in is not the same as deciding to chase it.
 *
 * Two code paths, because the bulk endpoint only rewrites copy rows that
 * already hold a *decision* status (undecided / wanted / not_wanted):
 *
 *   has a decision row  → one PATCH /photocards/bulk (row-scoped; possession
 *                         copies are never touched)
 *   has none            → POST a new Wanted copy per card. Rare — a card whose
 *                         only row is e.g. Pending - Incoming — but the bulk
 *                         UPDATE would match zero rows and skip it silently,
 *                         and silent is the wrong failure here.
 *
 * Cards holding Owned or Trade never reach this modal: `wanted` cannot co-exist
 * with either (see the triage plan's co-occurrence table), so the backend would
 * skip them anyway.
 */

const DECISION_CODES = ["undecided", "wanted", "not_wanted"];

export default function WantedSweepModal({
  candidates,
  wantedStatusId,
  statusCodeById,
  onClose,
  onDone,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { withDecision, withoutDecision } = useMemo(() => {
    const a = [];
    const b = [];
    for (const card of candidates) {
      const hasDecision = (card.copies || []).some((cp) =>
        DECISION_CODES.includes(statusCodeById.get(cp.ownership_status_id))
      );
      (hasDecision ? a : b).push(card);
    }
    return { withDecision: a, withoutDecision: b };
  }, [candidates, statusCodeById]);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      let updated = 0;
      let skipped = 0;

      if (withDecision.length) {
        const result = await bulkUpdatePhotocards(
          withDecision.map((c) => c.item_id),
          { ownership_status_id: wantedStatusId }
        );
        updated += result?.ownership?.updated ?? withDecision.length;
        skipped += result?.ownership?.skipped ?? 0;
      }

      for (const card of withoutDecision) {
        try {
          await createPhotocardCopy(card.item_id, { ownershipStatusId: wantedStatusId });
          updated += 1;
        } catch {
          skipped += 1;
        }
      }

      onDone(
        `Marked ${updated} card${updated !== 1 ? "s" : ""} Wanted` +
          (skipped ? ` · ${skipped} skipped` : "")
      );
    } catch (err) {
      setError(err.message || "Failed to update ownership.");
      setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      title="Mark these cards Wanted?"
      size="sm"
      footer={
        <>
          <button type="button" style={styles.btn} onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button type="button" style={styles.primaryBtn} onClick={handleConfirm} disabled={busy}>
            {busy ? "Updating…" : `Mark ${candidates.length} Wanted`}
          </button>
        </>
      }
    >
      {error && <div style={styles.error}>{error}</div>}

      <p style={styles.intro}>
        {candidates.length} card{candidates.length !== 1 ? "s" : ""} in this binder{" "}
        {candidates.length !== 1 ? "aren't" : "isn't"} Owned or Wanted. Binder saved either way.
      </p>

      <ul style={styles.list}>
        {candidates.map((card) => (
          <li key={card.item_id} style={styles.listItem}>
            {card.members?.join(", ") || `#${card.item_id}`}
            <span style={styles.sub}>
              {[card.source_origin, card.version].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const styles = {
  intro: {
    marginTop: 0,
    fontSize: "var(--text-sm)",
    color: "var(--text-secondary)",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: 260,
    overflowY: "auto",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  listItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "4px 8px",
    fontSize: "var(--text-sm)",
    borderBottom: "1px solid var(--border)",
  },
  sub: {
    color: "var(--text-muted)",
    fontSize: 11,
    textAlign: "right",
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
};
