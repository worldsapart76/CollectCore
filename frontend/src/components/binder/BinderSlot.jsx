import { useEffect, useState } from "react";
import { getImageUrl } from "../../utils/imageUrl";
import { getCopyBadges } from "../photocard/cardBadges";

/**
 * One pocket of a binder page.
 *
 * Drop target, drag source, and ✕-to-remove — the same staged-until-save
 * vocabulary as the Batch Images page. `readOnly` renders the reverse side of a
 * sheet you edit elsewhere (the left page of a spread): visible, never a target.
 *
 * Tapping a filled pocket picks the card up (`selected`), and tapping another
 * pocket drops it there. That's the whole editing model on touch, where HTML5
 * drag-and-drop doesn't fire at all.
 *
 * Image URLs come from `cacheBust`, a value the page computes once per card
 * load, rather than Date.now() per render — this component re-renders on every
 * dragover, and a changing src would re-request the image mid-drag.
 */

function slotSrc(card, side, cacheBust) {
  if (!card) return null;
  const path = side === "back" ? card.back_image_path : card.front_image_path;
  if (!path) return null;
  const url = getImageUrl(path);
  if (!url) return null;
  return url.startsWith("http") ? url : `${url}?v=${cacheBust}`;
}

export default function BinderSlot({
  card,
  side = "front",
  width,
  height,
  readOnly = false,
  armed = false,
  selected = false,
  cacheBust,
  onDropHere,
  onRemove,
  onDragStart,
  onDragEnd,
  onClick,
}) {
  const [over, setOver] = useState(false);
  const src = slotSrc(card, side, cacheBust);

  // A card can point at an image that isn't on R2 (never published, or removed).
  // Left alone the browser renders a broken-image box with the alt text spilling
  // out of the pocket, which reads as a layout bug. Fall back to the same muted
  // placeholder an image-less card gets.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [src]);
  const showImage = !!src && !imageFailed;

  const badges = card && side === "front" ? getCopyBadges(card.copies) : { primary: null, other: null };

  const canTarget = !readOnly;
  // Chrome shrinks with the pocket so a small sheet isn't all buttons.
  const compact = width < 72;
  const btnSize = compact ? 14 : 18;
  const badgeFont = compact ? 9 : 11;

  const caption = card
    ? [card.members?.join(", ") || `#${card.item_id}`, card.source_origin, card.version]
        .filter(Boolean)
        .join(" · ")
    : "";

  const borderColor = selected
    ? "solid var(--btn-primary-bg)"
    : over
      ? "dashed var(--btn-primary-bg)"
      : card
        ? "solid var(--border-input)"
        : armed && canTarget
          ? "dashed var(--btn-primary-bg)"
          : "dashed var(--border-input)";

  return (
    <div
      draggable={!readOnly && !!card}
      onDragStart={!readOnly && card ? onDragStart : undefined}
      onDragEnd={!readOnly && card ? onDragEnd : undefined}
      onDragOver={canTarget ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={canTarget ? () => setOver(false) : undefined}
      onDrop={canTarget ? (e) => { e.preventDefault(); setOver(false); onDropHere?.(); } : undefined}
      onClick={canTarget ? onClick : undefined}
      title={caption || (readOnly ? "" : "Empty pocket")}
      style={{
        position: "relative",
        width,
        height,
        borderRadius: "var(--radius-md)",
        border: `2px ${borderColor}`,
        background: over ? "var(--green-light)" : "var(--bg-surface)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: readOnly ? "default" : card ? "grab" : armed ? "copy" : "default",
        opacity: readOnly ? 0.85 : 1,
        boxSizing: "border-box",
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : card ? (
        <div style={styles.placeholder}>
          {imageFailed ? "Image missing" : side === "back" ? "No back" : "Awaiting photo"}
        </div>
      ) : null}

      {/* Ownership badges — fronts only, same vocabulary as the library grid */}
      {badges.primary && (
        <div
          className="pc-badge pc-badge--ownership"
          style={{ ...styles.ownershipBadge, fontSize: badgeFont, color: badges.primary.neonColor }}
        >
          {badges.primary.label}
        </div>
      )}
      {badges.other && (
        <div className="pc-badge pc-badge--other" style={{ ...styles.otherBadge, fontSize: badgeFont }}>
          {badges.other.map((part, i) => (
            <span key={i} style={{ color: part.color }}>
              {part.letter}{part.count > 1 ? part.count : ""}
            </span>
          ))}
        </div>
      )}
      {card?.is_special && side === "front" && (
        <div style={{ ...styles.specialBadge, fontSize: compact ? 14 : 18 }}>★</div>
      )}

      {card && !readOnly && (
        <button
          type="button"
          title="Remove from binder"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          style={{ ...styles.removeBtn, width: btnSize, height: btnSize, fontSize: compact ? 9 : 11 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

const styles = {
  placeholder: {
    fontSize: 10,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: 4,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    opacity: 0.75,
  },
  ownershipBadge: {
    position: "absolute",
    bottom: 3,
    left: 3,
    background: "var(--badge-bg)",
    fontWeight: "bold",
    padding: "1px 4px",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.4,
  },
  otherBadge: {
    position: "absolute",
    bottom: 3,
    right: 3,
    background: "var(--badge-bg)",
    fontWeight: "bold",
    padding: "1px 4px",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.4,
    display: "flex",
    gap: 1,
  },
  specialBadge: {
    position: "absolute",
    top: 2,
    left: 3,
    color: "var(--accent-special)",
    lineHeight: 1,
  },
  removeBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    background: "var(--danger-text)",
    color: "#fff",
    lineHeight: 1,
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
