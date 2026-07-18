// Authenticated /pcs/ photocard detail modal.
//
// Read-only catalog metadata (group, members, source origin, version,
// category, special, notes, cover images) + writeable per-user annotation
// section keyed by catalog_item_id. Server-backed twin of the WASM tier's
// GuestPhotocardDetailModal — identical UX, but writes go to /pcs/copies
// (pcsData) instead of local SQLite.
//
// Owned/Wanted mutual exclusion is enforced client-side here, mirroring
// admin's server-side rule, to keep the UX consistent.

import { useEffect, useRef, useState } from "react";
import Modal from "../components/primitives/Modal";
import { useSwipeNav } from "../hooks/useSwipeNav";
import {
  addPcsCardCopy,
  updatePcsCardCopy,
  deletePcsCardCopy,
  uploadPcsImage,
} from "./pcsData";

// Match admin's status_code values (from lkup_ownership_statuses).
// Owned and Wanted are mutually exclusive per card.
const OWNED_CODE = "owned";
const WANTED_CODE = "wanted";
const CATALOG_CODE = "catalog";

const navBtnStyle = {
  padding: "1px 7px",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  border: "1px solid var(--border-input)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-surface)",
  color: "inherit",
};

function resolveImageUrl(path) {
  if (!path) return null;
  // Catalog images are absolute R2 URLs (catalog/images/...).
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return path;
}

export default function PcsPhotocardDetailModal({
  card,
  allCards,
  ownershipStatuses,
  onClose,
  onChanged,
}) {
  const effectiveAllCards = allCards ?? [card];
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.max(0, effectiveAllCards.findIndex((c) => c.item_id === card.item_id)),
  );
  // Re-derive each render so parent reloads (fresh copies after onChanged)
  // flow through to the displayed card.
  const currentCard = effectiveAllCards[currentIndex] ?? card;

  // Local mirror of currentCard.copies so adds/updates/deletes reflect
  // immediately without waiting for the parent's reload round-trip.
  // Re-synced from props when the user navigates between cards.
  const [copies, setCopies] = useState(() => initialCopies(currentCard));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadingSide, setUploadingSide] = useState(null);

  async function handleUpload(side, file) {
    if (!file || uploadingSide) return;
    setUploadingSide(side);
    setError("");
    try {
      await uploadPcsImage(currentCard.item_id, side, file);
      onChanged?.(); // parent reloads → currentCard picks up the new image
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setUploadingSide(null);
    }
  }

  useEffect(() => {
    setCopies(initialCopies(currentCard));
    setError("");
  }, [currentCard?.item_id]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < effectiveAllCards.length - 1;
  const showNav = effectiveAllCards.length > 1;

  function handleNavigate(delta) {
    const target = currentIndex + delta;
    if (target < 0 || target >= effectiveAllCards.length) return;
    setCurrentIndex(target);
  }

  const swipeHandlers = useSwipeNav({
    onPrev: () => hasPrev && !busy && handleNavigate(-1),
    onNext: () => hasNext && !busy && handleNavigate(1),
  });

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
    if (!currentCard.catalog_item_id) {
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
      const copyId = await addPcsCardCopy({
        catalogItemId: currentCard.catalog_item_id,
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
      await updatePcsCardCopy(copy.copy_id, { ownershipStatusId: newStatusId });
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
      await updatePcsCardCopy(copy.copy_id, { notes: next });
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
      await deletePcsCardCopy(copy.copy_id);
      setCopies((prev) => {
        const remaining = prev.filter((c) => c.copy_id !== copy.copy_id);
        // If we deleted the last real copy, re-show the synthetic Catalog row
        // so the badge in the grid reverts and the picker resets.
        if (remaining.length === 0 && currentCard.catalog_item_id) {
          return initialCopies({ ...currentCard, copies: [] });
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

  const titleNode = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {showNav && (
        <button
          type="button"
          onClick={() => handleNavigate(-1)}
          disabled={!hasPrev || busy}
          title="Previous card"
          style={{ ...navBtnStyle, opacity: hasPrev ? 1 : 0.3 }}
        >
          ‹
        </button>
      )}
      <span>{currentCard?.group_name || "Photocard"}</span>
      {showNav && (
        <span
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            fontWeight: 400,
          }}
        >
          {currentIndex + 1}/{effectiveAllCards.length}
        </span>
      )}
      {showNav && (
        <button
          type="button"
          onClick={() => handleNavigate(1)}
          disabled={!hasNext || busy}
          title="Next card"
          style={{ ...navBtnStyle, opacity: hasNext ? 1 : 0.3 }}
        >
          ›
        </button>
      )}
    </span>
  );

  return (
    <Modal
      isOpen={!!currentCard}
      onClose={onClose}
      title={titleNode}
      size="md"
    >
      <div
        {...swipeHandlers}
        style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 13 }}
      >
        {/* Cover images — empty slots offer an "Add photo" that becomes THE
            shared catalog image for everyone (first-write-wins). align-items:
            flex-start so a filled slot keeps its aspect ratio instead of
            stretching to match an empty slot's taller (box + button) column. */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "flex-start" }}>
          <CardImage path={currentCard?.front_image_path} alt="Front" side="front"
            onUpload={handleUpload} uploading={uploadingSide === "front"} />
          <CardImage path={currentCard?.back_image_path} alt="Back" side="back"
            onUpload={handleUpload} uploading={uploadingSide === "back"} />
        </div>
        {(!currentCard?.front_image_path || !currentCard?.back_image_path) && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, marginTop: -8 }}>
            Have this card? Add a photo — it becomes the shared catalog image for everyone.
          </div>
        )}

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
          <Field label="Group" value={currentCard?.group_name} />
          <Field label="Category" value={currentCard?.category} />
          {(currentCard?.members?.length || 0) > 0 && (
            <Field label="Member" value={currentCard.members.join(", ")} />
          )}
          {currentCard?.source_origin && <Field label="Source" value={currentCard.source_origin} />}
          {currentCard?.version && <Field label="Version" value={currentCard.version} />}
          {currentCard?.is_special && <Field label="Type" value="Special" />}
        </div>

        <hr style={{ width: "100%", border: "none", borderTop: "1px solid var(--border)" }} />

        {/* Per-user copies editor */}
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
                    color: "var(--text-primary)",
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
  // Real copies only; the synthetic Catalog row (copy_id=null) is not editable.
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

function CardImage({ path, alt, side, onUpload, uploading }) {
  const url = resolveImageUrl(path);
  const inputRef = useRef(null);
  if (!url) {
    return (
      <div style={{ width: 140, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
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
        {onUpload && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 3,
                border: "1px solid var(--border-input)",
                background: "var(--bg-base)",
                color: "var(--text-primary)",
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "Uploading…" : `Add ${alt.toLowerCase()} photo`}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onUpload(side, f);
              }}
            />
          </>
        )}
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
          color: "var(--text-primary)",
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
