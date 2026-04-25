import { useState, useEffect } from "react";

export const MOBILE_BREAKPOINT = "(max-width: 768px)";
export const MOBILE_PAGE_INCREMENT = 30;

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

export function findScrollParent(el) {
  let parent = el?.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

function readCardsPerRow(key) {
  try {
    const v = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(v) && v >= 2 && v <= 8 ? v : 3;
  } catch { return 3; }
}

export function useMobileCardsPerRow(storageKey) {
  const [n, setN] = useState(() => readCardsPerRow(storageKey));
  useEffect(() => {
    try { localStorage.setItem(storageKey, String(n)); } catch {}
  }, [n, storageKey]);
  return [n, setN];
}

export function useMobileInfiniteScroll({ enabled, totalCount, sentinelRef, resetKey }) {
  const [visible, setVisible] = useState(MOBILE_PAGE_INCREMENT);
  useEffect(() => { setVisible(MOBILE_PAGE_INCREMENT); }, [resetKey]);
  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((c) => Math.min(c + MOBILE_PAGE_INCREMENT, totalCount));
        }
      },
      { root: findScrollParent(el), rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, totalCount, visible, sentinelRef]);
  return visible;
}

const stepperBtn = {
  width: 28, height: 28, fontSize: 16, cursor: "pointer",
  border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)",
  background: "var(--bg-base)",
};

export function MobilePerRowStepper({ value, onChange, min = 2, max = 8 }) {
  return (
    <span
      className="mobile-only"
      style={{ alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>Per row</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Fewer cards per row"
        style={stepperBtn}
      >−</button>
      <span style={{ minWidth: 18, textAlign: "center" }}>{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="More cards per row"
        style={stepperBtn}
      >+</button>
    </span>
  );
}

export function MobileInfiniteSentinel({ visible, total, sentinelRef }) {
  if (!visible || visible >= total) return null;
  return (
    <div
      ref={sentinelRef}
      style={{ padding: "16px 0", textAlign: "center", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
    >
      Loading more…
    </div>
  );
}
