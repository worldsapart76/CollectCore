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
 *   PAGE_SIZE      — number of cards per page (default 30)
 */

const PAGE_SIZE = 30;

// First-letter → color mapping so any status name gets a badge
const BADGE_LETTER_COLORS = {
  O: "#2e7d32",  // Owned
  W: "#f57f17",  // Want / Wishlist
  F: "#c62828",  // For Trade / For Sale
  T: "#1565c0",  // Trading
  S: "#6a1b9a",  // Sold / Selling
};

function getOwnershipBadge(statusName) {
  if (!statusName) return null;
  const letter = statusName[0].toUpperCase();
  const color = BADGE_LETTER_COLORS[letter] || "#607d8b";
  return { label: letter, color };
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
}) {
  const { cellWidth, imageHeight } = SIZE_CONFIG[sizeMode] || SIZE_CONFIG.m;
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageCards = cards.slice(start, start + PAGE_SIZE);

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
            Page {safePage} of {totalPages} ({cards.length} cards)
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
        <div style={styles.countLine}>{cards.length} cards</div>
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
  const badge = getOwnershipBadge(card.ownership_status);
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
          badge={badge}
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
          {(card.source_origin || card.version) && (
            <span style={styles.captionSub}>
              {[card.source_origin, card.version].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      )}

      {selectMode && selected && (
        <div style={styles.selectOverlay}>✓</div>
      )}
    </div>
  );
}

function ImageSlot({ path, side, width, height, badge }) {
  const API_BASE = "http://127.0.0.1:8001";

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
          src={`${API_BASE}/images/library/${path.replace(/^.*[\\/]/, "")}`}
          alt={side}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div style={styles.imagePlaceholder}>
          {side === "front" ? "No front" : "No back"}
        </div>
      )}

      {badge && side === "front" && (
        <div style={{ ...styles.ownershipBadge, background: badge.color }}>
          {badge.label}
        </div>
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
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
    width: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
    lineHeight: 1,
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
