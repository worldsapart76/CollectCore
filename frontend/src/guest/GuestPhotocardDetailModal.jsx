// Phase 7c: guest-side photocard detail modal.
//
// Read-only catalog metadata (group, members, source origin, version,
// category, special, notes, cover images) + writeable guest annotation
// section keyed by catalog_item_id. Mirrors admin's PhotocardDetailModal
// shape at a glance but is a much simpler component — no edit form for
// catalog fields, no delete, no source-origin creation, no member picker.
//
// Owned/Wanted mutual exclusion is enforced client-side here. Admin's
// version enforces it server-side via _check_owned_wanted_conflict in
// routers/photocards.py; replicating the rule keeps the UX consistent.
//
// Tree-shaking: this module imports sqliteService (which pulls in the
// worker + sqlite-wasm). It must NEVER be imported from admin code paths.
// PhotocardLibraryPage gates its render behind isAdmin; the import in
// that file uses a constant-folded `import.meta.env.VITE_IS_ADMIN === "true"
// ? null : lazy(() => import(...))` so admin bundles don't pull this in.

import { useEffect, useState } from "react";
import Modal from "../components/primitives/Modal";
import {
  addGuestCardCopy,
  updateGuestCardCopy,
  deleteGuestCardCopy,
} from "./sqliteService";

// Match admin's status_code values (synced from lkup_ownership_statuses).
// Owned and Wanted are mutually exclusive per card.
const OWNED_CODE = "owned";
const WANTED_CODE = "wanted";
const CATALOG_CODE = "catalog";

function resolveImageUrl(path) {
  if (!path) return null;
  // Catalog images are absolute R2 URLs post-cutover (catalog/images/...).
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // Defensive fallback — shouldn't trigger for guests since the seed only
  // contains hosted attachments.
  return path;
}

export default function GuestPhotocardDetailModal({
  card,
  ownershipStatuses,
  onClose,
  onChanged,
}) {
  // Local mirror of card.copies so adds/updates/deletes reflect immediately
  // without waiting for the parent's reload round-trip. Re-synced from
  // props when the user navigates between cards (key on item_id).
  const [copies, setCopies] = useState(() => initialCopies(card));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCopies(initialCopies(card));
    setError("");
  }, [card?.item_id]);

  // Filter out Catalog from the picker — adding a Catalog row is a no-op
  // for the user (it's the synthetic default state). Keep all other
  // statuses including For Trade, In Box, etc.
  const pickableStatuses = (ownershipStatuses || []).filter(
    (s) => s.status_code !== CATALOG_CODE,
  );

  const ownedId = lookupStatusId(ownershipStatuses, OWNED_CODE);
  const wantedId = lookupStatusId(ownershipStatuses, WANTED_CODE);

  // Owned/Wanted exclusion: if the card has any non-Catalog copy, the
  // opposing status (Owned <-> Wanted) is disabled in any new picker.
  function disabledForNewRow(statusId) {
    if (statusId === ownedId) return copies.some((c) => c.ownership_status_id === wantedId);
    if (statusId === wantedId) return copies.some((c) => c.ownership_status_id === ownedId);
    return false;
  }

  function disabledForExistingRow(statusId, copyId) {
    if (statusId === ownedId) {
      return copies.some((c) => c.copy_id !== copyId && c.ownership_status_id === wantedId);
    }
    if (statusId === wantedId) {
      return copies.some((c) => c.copy_id !== copyId && c.ownership_status_id === ownedId);
    }
    return false;
  }

  async function handleAdd(statusId) {
    if (!card.catalog_item_id) {
      setError("Cannot add a copy — this card has no catalog ID.");
      return;
    }
    if (disabledForNewRow(statusId)) {
      setError("Owned and Wanted can't both apply to the same card. Remove the existing one first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const copyId = await addGuestCardCopy({
        catalogItemId: card.catalog_item_id,
        ownershipStatusId: statusId,
      });
      const status = ownershipStatuses.find((s) => s.ownership_status_id === statusId);
      setCopies((prev) => [
        ...prev.filter((c) => c.copy_id != null), // drop the synthetic Catalog row
        {
          copy_id: copyId,
          ownership_status_id: statusId,
          ownership_status: status?.status_name || "",
          notes: null,
        },
      ]);
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(copy, newStatusId) {
    if (newStatusId === copy.ownership_status_id) return;
    if (disabledForExistingRow(newStatusId, copy.copy_id)) {
      setError("Owned and Wanted can't both apply to the same card.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateGuestCardCopy(copy.copy_id, { ownershipStatusId: newStatusId });
      const status = ownershipStatuses.find((s) => s.ownership_status_id === newStatusId);
      setCopies((prev) =>
        prev.map((c) =>
          c.copy_id === copy.copy_id
            ? { ...c, ownership_status_id: newStatusId, ownership_status: status?.status_name || "" }
            : c,
        ),
      );
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleNotesBlur(copy, value) {
    const next = value.trim() || null;
    if (next === copy.notes) return;
    setBusy(true);
    setError("");
    try {
      await updateGuestCardCopy(copy.copy_id, { notes: next });
      setCopies((prev) =>
        prev.map((c) => (c.copy_id === copy.copy_id ? { ...c, notes: next } : c)),
      );
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(copy) {
    setBusy(true);
    setError("");
    try {
      await deleteGuestCardCopy(copy.copy_id);
      setCopies((prev) => {
        const remaining = prev.filter((c) => c.copy_id !== copy.copy_id);
        // If we deleted the last real copy, re-show the synthetic Catalog row
        // so the badge in the grid reverts and the picker resets.
        if (remaining.length === 0 && card.catalog_item_id) {
          return initialCopies({ ...card, copies: [] });
        }
        return remaining;
      });
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const realCopies = copies.filter((c) => c.copy_id != null);

  return (
    <Modal
      isOpen={!!card}
      onClose={onClose}
      title={card?.group_name || "Photocard"}
      size="md"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 13 }}>
        {/* Cover images */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <CardImage path={card?.front_image_path} alt="Front" />
          {card?.back_image_path && <CardImage path={card.back_image_path} alt="Back" />}
        </div>

        {/* Catalog metadata (read-only) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "min-content 1fr",
            columnGap: 12,
            rowGap: 4,
            fontSize: 13,
          }}
        >
          <Field label="Group" value={card?.group_name} />
          <Field label="Category" value={card?.category} />
          {(card?.members?.length || 0) > 0 && (
            <Field label="Member" value={card.members.join(", ")} />
          )}
          {card?.source_origin && <Field label="Source" value={card.source_origin} />}
          {card?.version && <Field label="Version" value={card.version} />}
          {card?.is_special && <Field label="Type" value="Special" />}
          {card?.notes && <Field label="Catalog notes" value={card.notes} />}
        </div>

        <hr style={{ width: "100%", border: "none", borderTop: "1px solid var(--border)" }} />

        {/* Guest copies editor */}
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Your copies</h3>

          {realCopies.length === 0 ? (
            <p style={{ color: "var(--text-muted)", margin: "0 0 8px" }}>
              You don't have this card yet. Pick a status below to add it to
              your collection.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {realCopies.map((copy) => (
                <CopyRow
                  key={copy.copy_id}
                  copy={copy}
                  pickableStatuses={pickableStatuses}
                  isDisabled={(sid) => disabledForExistingRow(sid, copy.copy_id)}
                  busy={busy}
                  onStatusChange={(sid) => handleStatusChange(copy, sid)}
                  onNotesBlur={(v) => handleNotesBlur(copy, v)}
                  onDelete={() => handleDelete(copy)}
                />
              ))}
            </div>
          )}

          {/* Add a new copy — quick status buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Add copy as:</span>
            {pickableStatuses.map((s) => {
              const disabled = busy || disabledForNewRow(s.ownership_status_id);
              return (
                <button
                  key={s.ownership_status_id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleAdd(s.ownership_status_id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    borderRadius: 3,
                    border: "1px solid var(--border-input)",
                    background: disabled ? "var(--bg-disabled, #eee)" : "var(--bg-base)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.6 : 1,
                  }}
                >
                  {s.status_name}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "8px 12px",
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

function initialCopies(card) {
  if (!card) return [];
  // Synthesize a Catalog placeholder so the badge logic and "no copies"
  // empty state both have something to anchor on. The synthetic row has
  // copy_id=null and is dropped on first real add.
  if (!card.copies || card.copies.length === 0) {
    return [];
  }
  return card.copies;
}

function lookupStatusId(statuses, code) {
  return statuses?.find((s) => s.status_code === code)?.ownership_status_id ?? null;
}

function Field({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <>
      <div style={{ color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: 12 }}>{label}</div>
      <div>{value}</div>
    </>
  );
}

function CardImage({ path, alt }) {
  const url = resolveImageUrl(path);
  if (!url) {
    return (
      <div
        style={{
          width: 140,
          aspectRatio: "65 / 100",
          background: "var(--bg-placeholder, #eee)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 11,
          borderRadius: 4,
        }}
      >
        {alt}: no image
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={{
        width: 140,
        aspectRatio: "65 / 100",
        objectFit: "cover",
        borderRadius: 4,
        background: "var(--bg-placeholder, #eee)",
      }}
    />
  );
}

function CopyRow({ copy, pickableStatuses, isDisabled, busy, onStatusChange, onNotesBlur, onDelete }) {
  const [notes, setNotes] = useState(copy.notes || "");
  useEffect(() => { setNotes(copy.notes || ""); }, [copy.notes]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        border: "1px solid var(--border)",
        borderRadius: 4,
        background: "var(--bg-surface)",
      }}
    >
      <select
        value={copy.ownership_status_id}
        disabled={busy}
        onChange={(e) => onStatusChange(Number(e.target.value))}
        style={{ padding: "3px 6px", fontSize: 13 }}
      >
        {pickableStatuses.map((s) => (
          <option
            key={s.ownership_status_id}
            value={s.ownership_status_id}
            disabled={s.ownership_status_id !== copy.ownership_status_id && isDisabled(s.ownership_status_id)}
          >
            {s.status_name}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => onNotesBlur(notes)}
        disabled={busy}
        style={{
          flex: "1 1 160px",
          minWidth: 120,
          padding: "3px 6px",
          fontSize: 13,
          border: "1px solid var(--border-input)",
          borderRadius: 3,
        }}
      />

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        title="Remove this copy"
        style={{
          padding: "3px 8px",
          fontSize: 12,
          background: "var(--bg-base)",
          border: "1px solid var(--border-input)",
          borderRadius: 3,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        Remove
      </button>
    </div>
  );
}
