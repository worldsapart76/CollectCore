import BinderSlot from "./BinderSlot";
import {
  SHEET_BORDER,
  SHEET_LABEL_HEIGHT,
  SHEET_PADDING,
  SLOT_GAP,
  layoutOf,
  mirrorSlot,
  pocketCount,
  pocketHeight,
  sheetSize,
} from "./binderLayout";

/**
 * One sheet of a binder, front or back.
 *
 * Front: display position === slot_index, showing front images.
 * Back:  display position d shows the card in slot mirrorSlot(d) with its back
 *        image — flipping a page reverses the columns. Backs are always
 *        read-only; you edit a sheet from its front, where the coordinates are
 *        the ones you dragged into.
 *
 * `pocketWidth` is measured by the page to fill the space available, so the
 * sheet is as large as it can be without scrolling. Every dimension here is
 * derived from constants in binderLayout.js — the same ones the measurement
 * uses, so the two cannot drift.
 */
export default function BinderSheet({
  layoutCode,
  slots = {},            // { [slotIndex]: itemId }
  cardsById,
  side = "front",
  pocketWidth,
  armed = false,
  armedSlot = null,      // slot_index of the card picked up on this sheet, if any
  cacheBust,
  label,
  onDropSlot,
  onRemoveSlot,
  onDragStartSlot,
  onDragEndSlot,
  onSlotClick,
  onLabelClick,
}) {
  const { cols } = layoutOf(layoutCode);
  const pockets = pocketCount(layoutCode);
  const height = pocketHeight(pocketWidth);
  const isBack = side === "back";

  return (
    <div style={styles.sheet}>
      <div
        style={{ ...styles.label, cursor: onLabelClick ? "pointer" : "default" }}
        onClick={onLabelClick}
        title={onLabelClick ? "Jump to this sheet" : undefined}
      >
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${pocketWidth}px)`,
          gap: SLOT_GAP,
          padding: SHEET_PADDING,
          background: "var(--bg-base)",
          border: `${SHEET_BORDER}px solid var(--border)`,
          borderRadius: "var(--radius-md)",
          boxSizing: "border-box",
        }}
      >
        {Array.from({ length: pockets }, (_, displayIndex) => {
          const slotIndex = isBack ? mirrorSlot(displayIndex, cols) : displayIndex;
          const itemId = slots[slotIndex];
          return (
            <BinderSlot
              key={displayIndex}
              card={itemId != null ? cardsById.get(itemId) : null}
              side={side}
              width={pocketWidth}
              height={height}
              readOnly={isBack}
              armed={armed}
              selected={!isBack && armedSlot === slotIndex}
              cacheBust={cacheBust}
              onDropHere={() => onDropSlot?.(slotIndex)}
              onRemove={() => onRemoveSlot?.(slotIndex)}
              onDragStart={() => onDragStartSlot?.(slotIndex)}
              onDragEnd={onDragEndSlot}
              onClick={() => onSlotClick?.(slotIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Empty left/right half of the first and last spread — the binder's covers.
 * Sized to match a real sheet so the spread doesn't shift as you page through.
 */
export function BinderCover({ label, pocketWidth, layoutCode }) {
  const { width, height } = sheetSize(pocketWidth, layoutCode);
  return (
    <div style={styles.sheet}>
      <div style={styles.label}>{label}</div>
      <div style={{ ...styles.cover, width, height }}>{label}</div>
    </div>
  );
}

const styles = {
  sheet: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  label: {
    height: SHEET_LABEL_HEIGHT,
    lineHeight: `${SHEET_LABEL_HEIGHT}px`,
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  cover: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `${SHEET_BORDER}px dashed var(--border)`,
    borderRadius: "var(--radius-md)",
    color: "var(--text-muted)",
    fontSize: "var(--text-sm)",
    background: "var(--bg-surface)",
    padding: 16,
    textAlign: "center",
    boxSizing: "border-box",
  },
};
