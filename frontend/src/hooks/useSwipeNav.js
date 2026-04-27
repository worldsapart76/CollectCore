import { useRef } from "react";

/**
 * Touch-swipe horizontal navigation. Returns spread-able touch handlers:
 *   <div {...useSwipeNav({ onPrev, onNext })}>...</div>
 *
 * Triggers `onPrev` on right-swipe and `onNext` on left-swipe when the
 * gesture's horizontal travel exceeds `threshold` (default 60px) AND is
 * dominantly horizontal (|dx| > 2 * |dy|). The dominance guard keeps
 * vertical scrolls inside the swipe target from triggering navigation.
 *
 * Single-touch only — multi-touch gestures (pinch/zoom) are ignored so
 * image gestures inside the modal still work.
 */
export function useSwipeNav({ onPrev, onNext, threshold = 60 } = {}) {
  const start = useRef(null);
  return {
    onTouchStart(e) {
      if (!e.touches || e.touches.length !== 1) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd(e) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (dx < 0) onNext?.();
      else onPrev?.();
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}
