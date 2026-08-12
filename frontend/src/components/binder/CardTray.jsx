import { getImageUrl } from "../../utils/imageUrl";
import { getCopyBadges } from "../photocard/cardBadges";

/**
 * Available-cards tray.
 *
 * The list is *derived* — filtered cards minus everything already in a pocket —
 * rather than a mutated array, which is what makes a removed card reappear at
 * its sort position instead of at the bottom. Nothing to append to.
 *
 * Renders `limit` cards at a time with a Show-more button: the library runs to
 * ~10k cards and CollectCore deliberately has no virtualization.
 *
 * `orientation="horizontal"` is the phone layout — a single scrolling row under
 * the binder page, where a full-height column would leave no room for the sheet.
 */

const THUMB_W = 52;
const THUMB_H = 74;

export default function CardTray({
  cards,
  limit,
  onShowMore,
  armedItemId,
  onArm,
  onDragStart,
  onDragEnd,
  cacheBust,
  orientation = "vertical",
}) {
  const shown = cards.slice(0, limit);
  const horizontal = orientation === "horizontal";

  return (
    <div style={horizontal ? styles.wrapH : styles.wrap}>
      <div style={horizontal ? styles.headerH : styles.header}>
        <span>Available ({cards.length})</span>
        {horizontal && <span style={styles.hintInline}>tap a card, then a pocket</span>}
      </div>

      {cards.length === 0 ? (
        <div style={styles.empty}>
          No cards match these filters, or they're all placed already.
        </div>
      ) : (
        <div style={horizontal ? styles.gridH : styles.grid}>
          {shown.map((card) => {
            const { primary } = getCopyBadges(card.copies);
            const src = card.front_image_path ? getImageUrl(card.front_image_path) : null;
            const armed = armedItemId === card.item_id;
            return (
              <div
                key={card.item_id}
                draggable
                onDragStart={() => onDragStart(card.item_id)}
                onDragEnd={onDragEnd}
                onClick={() => onArm(armed ? null : card.item_id)}
                title={[card.members?.join(", ") || `#${card.item_id}`, card.source_origin, card.version]
                  .filter(Boolean)
                  .join(" · ")}
                style={{
                  ...styles.thumb,
                  outline: armed ? "2px solid var(--btn-primary-bg)" : "2px solid transparent",
                }}
              >
                {src ? (
                  <img
                    src={src.startsWith("http") ? src : `${src}?v=${cacheBust}`}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    // Some cards point at an image that isn't on R2. Hide the
                    // broken-image box rather than letting it break the strip.
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div style={styles.noImage}>no img</div>
                )}
                {primary && (
                  <div className="pc-badge" style={{ ...styles.badge, color: primary.neonColor }}>
                    {primary.label}
                  </div>
                )}
                {card.is_special && <div style={styles.special}>★</div>}
              </div>
            );
          })}

          {horizontal && cards.length > limit && (
            <button type="button" onClick={onShowMore} style={styles.moreBtnH}>
              +100
            </button>
          )}
        </div>
      )}

      {!horizontal && cards.length > limit && (
        <button type="button" onClick={onShowMore} style={styles.moreBtn}>
          Show {Math.min(100, cards.length - limit)} more
        </button>
      )}

      {!horizontal && (
        <div style={styles.hint}>
          Drag onto a pocket, or click a card then click a pocket.
        </div>
      )}
    </div>
  );
}

const headerBase = {
  fontSize: 11,
  fontWeight: "bold",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  flexShrink: 0,
};

const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-surface)",
  },
  wrapH: {
    display: "flex",
    flexDirection: "column",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
    flexShrink: 0,
  },
  header: {
    ...headerBase,
    padding: "6px 8px",
    borderBottom: "1px solid var(--border)",
  },
  headerH: {
    ...headerBase,
    padding: "4px 8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  hintInline: {
    textTransform: "none",
    letterSpacing: 0,
    fontWeight: "normal",
  },
  grid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 5,
    padding: 8,
    overflowY: "auto",
    alignContent: "flex-start",
    flex: 1,
    minHeight: 0,
  },
  gridH: {
    display: "flex",
    gap: 5,
    padding: "0 8px 8px",
    overflowX: "auto",
    overflowY: "hidden",
    alignItems: "center",
  },
  thumb: {
    position: "relative",
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
    border: "1px solid var(--border-input)",
    background: "var(--bg-base)",
    cursor: "grab",
    flexShrink: 0,
  },
  noImage: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    color: "var(--text-muted)",
  },
  badge: {
    position: "absolute",
    bottom: 2,
    left: 2,
    background: "var(--badge-bg)",
    fontWeight: "bold",
    fontSize: 10,
    padding: "0 3px",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.4,
  },
  special: {
    position: "absolute",
    top: 0,
    right: 2,
    color: "var(--accent-special)",
    fontSize: 13,
    lineHeight: 1.2,
  },
  empty: {
    padding: 12,
    fontSize: "var(--text-sm)",
    color: "var(--text-muted)",
    flex: 1,
  },
  moreBtn: {
    margin: "0 8px 8px",
    padding: "4px 8px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
    flexShrink: 0,
  },
  moreBtnH: {
    height: THUMB_H,
    padding: "0 10px",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--border-input)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-base)",
    flexShrink: 0,
  },
  hint: {
    padding: "6px 8px",
    fontSize: 11,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
};
