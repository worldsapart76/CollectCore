import { API_BASE } from "../../utils/imageUrl";

/**
 * PhotocardGrid — displays cards in a compact grid.
 *
 * Props:
 *   cards          — filtered+sorted array of photocard objects
 *   viewMode       — "fronts" | "fronts_backs"
 *   sizeMode       — "s" | "m" | "l"
 *   showCaptions   — boolean
 *   selectMode     — boolean
 *   selectedIds    — Set of selected item_id strings
 *   onCardClick    — callback(card) — open detail or toggle select
 *   page           — current page number (1-based)
 *   onPageChange   — callback(newPage)
 *   pageSize       — number of cards per page (default 30, 0 = all)
 */

// Status → letter mapping
const STATUS_LETTERS = {
  Owned: "O",
  Wanted: "W",
  Trade: "T",
  "Formerly Owned": "F",
  "Pending - Outgoing": "P",
  Borrowed: "B",
  "Pending - Incoming": "I",
};

// Letter → neon color mapping
const BADGE_LETTER_COLORS = {
  O: "#39ff14",  // Owned — neon green
  W: "#ffff00",  // Wanted — neon yellow
  T: "#ff3131",  // Trade — neon red
  F: "#607d8b",  // Formerly Owned — grey
  P: "#ff9900",  // Pending - Outgoing — neon orange
  B: "#00bcd4",  // Borrowed — cyan
  I: "#00bfff",  // Pending - Incoming — sky blue
};

// Render order for non-Owned/non-Wanted statuses (bottom-right)
const OTHER_STATUS_ORDER = ["T", "P", "I", "B", "F"];

function getCopyBadges(copies) {
  if (!copies || copies.length === 0) return { primary: null, other: null };

  // Count by letter
  const counts = {};
  for (const c of copies) {
    const letter = STATUS_LETTERS[c.ownership_status] || c.ownership_status[0].toUpperCase();
    counts[letter] = (counts[letter] || 0) + 1;
  }

  // Primary badge (bottom-left) — O or W, mutually exclusive, always singular
  let primary = null;
  if (counts.O) {
    primary = { label: "O", neonColor: BADGE_LETTER_COLORS.O };
  } else if (counts.W) {
    primary = { label: "W", neonColor: BADGE_LETTER_COLORS.W };
  }

  // Other statuses badge (bottom-right) — everything except O and W
  let other = null;
  const otherParts = [];
  for (const letter of OTHER_STATUS_ORDER) {
    if (counts[letter]) {
      otherParts.push({ letter, count: counts[letter], color: BADGE_LETTER_COLORS[letter] || "#fff" });
    }
  }
  if (otherParts.length > 0) {
    other = otherParts;
  }

  return { primary, other };
}

const SIZE_CONFIG = {
  s: { cellWidth: 100, imageHeight: 138 },
  m: { cellWidth: 150, imageHeight: 206 },
  l: { cellWidth: 200, imageHeight: 275 },
};

export default function PhotocardGrid({
  cards,
  viewMode = "fronts",
  sizeMode = "m",
  showCaptions = true,
  selectMode = false,
  selectedIds = new Set(),
  onCardClick,
  page,
  onPageChange,
  pageSize = 30,
  copyCount,
}) {
  const { cellWidth, imageHeight } = SIZE_CONFIG[sizeMode] || SIZE_CONFIG.m;
  const effectivePageSize = pageSize === 0 ? cards.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(cards.length / effectivePageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * effectivePageSize;
  const pageCards = cards.slice(start, start + effectivePageSize);

  if (cards.length === 0) {
    return (
      <div style={{ padding: 32, color: "#999", textAlign: "center" }}>
        No cards match the current filters.
      </div>
    );
  }

  return (
    <div>
      {/* Grid */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {pageCards.map((card) => (
          <CardCell
            key={card.item_id}
            card={card}
            cellWidth={cellWidth}
            imageHeight={imageHeight}
            viewMode={viewMode}
            showCaptions={showCaptions}
            selectMode={selectMode}
            selected={selectedIds.has(String(card.item_id))}
            onClick={() => onCardClick(card)}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button
            style={styles.pageBtn}
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            ← Prev
          </button>
          <span style={styles.pageInfo}>
            Page {safePage} of {totalPages} ({cards.length} cards{copyCount != null && copyCount !== cards.length ? `, ${copyCount} copies` : ""})
          </span>
          <button
            style={styles.pageBtn}
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {cards.length > 0 && totalPages === 1 && (
        <div style={styles.countLine}>
          {cards.length} cards{copyCount != null && copyCount !== cards.length ? `, ${copyCount} copies` : ""}
        </div>
      )}
    </div>
  );
}

function CardCell({
  card,
  cellWidth,
  imageHeight,
  viewMode,
  showCaptions,
  selectMode,
  selected,
  onClick,
}) {
  const { primary, other } = getCopyBadges(card.copies);
  const isFrontsBacksMode = viewMode === "fronts_backs";
  const totalWidth = isFrontsBacksMode ? cellWidth * 2 + 4 : cellWidth;

  return (
    <div
      onClick={onClick}
      style={{
        ...styles.cell,
        width: totalWidth,
        cursor: "pointer",
        outline: selected ? "2px solid #1565c0" : "2px solid transparent",
        outlineOffset: 1,
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {/* Front image */}
        <ImageSlot
          path={card.front_image_path}
          side="front"
          width={cellWidth}
          height={imageHeight}
          primaryBadge={primary}
          otherBadges={other}
          isSpecial={card.is_special}
        />

        {/* Back image (fronts+backs mode) */}
        {isFrontsBacksMode && (
          <ImageSlot
            path={card.back_image_path}
            side="back"
            width={cellWidth}
            height={imageHeight}
          />
        )}
      </div>

      {showCaptions && (
        <div style={styles.caption}>
          <span style={styles.captionText}>
            {card.members?.join(", ") || "—"}
          </span>
          {card.source_origin && (
            <span style={styles.captionSub}>{card.source_origin}</span>
          )}
          {card.version && (
            <span style={styles.captionSub}>{card.version}</span>
          )}
        </div>
      )}

      {selectMode && selected && (
        <div style={styles.selectOverlay}>✓</div>
      )}
    </div>
  );
}

function ImageSlot({ path, side, width, height, primaryBadge, otherBadges, isSpecial }) {
  return (
    <div
      style={{
        ...styles.imageSlot,
        width,
        height,
      }}
    >
      {path ? (
        <img
          src={`${API_BASE}/images/library/${path.replace(/^.*[\\/]/, "")}?v=${Date.now()}`}
          alt={side}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div style={styles.imagePlaceholder}>
          {side === "front" ? "No front" : "No back"}
        </div>
      )}

      {/* Primary badge (O or W) — bottom-left */}
      {primaryBadge && side === "front" && (
        <div style={{ ...styles.ownershipBadge, color: primaryBadge.neonColor }}>
          {primaryBadge.label}
        </div>
      )}

      {/* Other statuses badge — bottom-right */}
      {otherBadges && side === "front" && (
        <div style={styles.otherBadge}>
          {otherBadges.map((part, i) => (
            <span key={i} style={{ color: part.color }}>
              {part.letter}{part.count > 1 ? part.count : ""}
            </span>
          ))}
        </div>
      )}

      {/* Special star — top-right */}
      {isSpecial && side === "front" && (
        <div style={styles.specialBadge}>★</div>
      )}
    </div>
  );
}

const styles = {
  cell: {
    position: "relative",
    background: "#f9f9f9",
    border: "1px solid #e0e0e0",
    borderRadius: 3,
    overflow: "hidden",
  },
  imageSlot: {
    position: "relative",
    background: "#eee",
    flexShrink: 0,
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: "#bbb",
    textAlign: "center",
    padding: 4,
    boxSizing: "border-box",
  },
  ownershipBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    background: "#000",
    fontWeight: "bold",
    fontSize: 12,
    padding: "2px 4px",
    minWidth: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
    lineHeight: 1,
  },
  otherBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    background: "#000",
    fontWeight: "bold",
    fontSize: 12,
    padding: "2px 4px",
    minWidth: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
    lineHeight: 1,
    gap: 1,
  },
  specialBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    color: "#f5c518",
    fontSize: 26,
    lineHeight: 1,
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
  },
  caption: {
    padding: "3px 4px",
    borderTop: "1px solid #e0e0e0",
  },
  captionText: {
    display: "block",
    fontSize: 11,
    color: "#333",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  captionSub: {
    display: "block",
    fontSize: 10,
    color: "#777",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selectOverlay: {
    position: "absolute",
    top: 4,
    right: 4,
    background: "#1565c0",
    color: "#fff",
    borderRadius: "50%",
    width: 18,
    height: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: "bold",
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px solid #e0e0e0",
  },
  pageBtn: {
    padding: "4px 10px",
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #ccc",
    borderRadius: 3,
    background: "#fff",
  },
  pageInfo: {
    fontSize: 13,
    color: "#555",
  },
  countLine: {
    marginTop: 8,
    fontSize: 12,
    color: "#999",
  },
};
