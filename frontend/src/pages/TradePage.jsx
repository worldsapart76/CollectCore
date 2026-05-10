import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchTradeData } from "../api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

// Probe admin viewer mode by hitting the gated /admin/trade-ownership
// endpoint. When the viewer isn't signed into Cloudflare Access, CF
// returns a 302 to its login page on a different origin — a normal
// fetch follows the redirect and the browser then logs a CORS error
// because the login response has no Access-Control-Allow-Origin header.
// `redirect: 'manual'` short-circuits before the redirect is followed,
// so the browser doesn't try to read the cross-origin response and
// doesn't emit the CORS message. Admin viewers (cookie present) get
// a normal 200 response that flows through unchanged.
async function tryAdminOwnership(catalogItemIds) {
  try {
    const ids = catalogItemIds.join(",");
    const url = `${API_BASE}/admin/trade-ownership?ids=${encodeURIComponent(ids)}`;
    const res = await fetch(url, { credentials: "include", redirect: "manual" });
    if (res.type === "opaqueredirect" || res.status === 0 || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
import { useMediaQuery, useMobileCardsPerRow, MOBILE_BREAKPOINT, MobilePerRowStepper } from "../components/library/mobileGrid";

// Public-facing trade page. Three viewer modes:
//   admin  → fetchTradeOwnership succeeds → use the returned map
//   guest  → admin call fails (CF Access redirect) but OPFS has guest_card_copies
//   unauth → both probes fail → render without badges
//
// We don't have a separate /admin/me probe — the failure of fetchTradeOwnership
// IS the "you're not admin" signal, and rolling the two together saves one
// fetch + one console CORS error per non-admin viewer.

const BADGE_LABELS = {
  owned:          "You own this card.",
  wanted:         "This card is on your wanted list.",
  in_catalog:     "You do not own this card but it is not on your wanted list.",
  not_in_catalog: "Not yet in your catalog.",
};

const BADGE_TONES = {
  owned:          { bg: "#16a34a", fg: "#fff", label: "Owned" },
  wanted:         { bg: "#2563eb", fg: "#fff", label: "Wanted" },
  in_catalog:     { bg: "#6b7280", fg: "#fff", label: "Don't own" },
  not_in_catalog: { bg: "#a16207", fg: "#fff", label: "Not in catalog" },
};

const TRADE_PER_ROW_KEY = "trade.mobileCardsPerRow";

async function probeGuestOwnership(catalogItemIds) {
  // Lazy import — only fetched when the admin probe falls through. Returns
  // null on any failure so the page degrades to unauth mode silently.
  let svc;
  try {
    svc = await import("../guest/sqliteService");
  } catch {
    return null;
  }
  try {
    const init = await svc.initSqlite();
    if (!init?.hasCatalog) return null;
  } catch {
    return null;
  }
  try {
    const placeholders = catalogItemIds.map(() => "?").join(",");
    const copyRows = await svc.query(
      `SELECT gc.catalog_item_id,
              MAX(CASE WHEN os.status_code = 'owned'  THEN 1 ELSE 0 END) AS is_owned,
              MAX(CASE WHEN os.status_code = 'wanted' THEN 1 ELSE 0 END) AS is_wanted
       FROM guest_card_copies gc
       JOIN lkup_ownership_statuses os ON os.ownership_status_id = gc.ownership_status_id
       WHERE gc.catalog_item_id IN (${placeholders})
       GROUP BY gc.catalog_item_id`,
      catalogItemIds,
    );
    const catalogRows = await svc.query(
      `SELECT catalog_item_id FROM tbl_items
       WHERE catalog_item_id IN (${placeholders})`,
      catalogItemIds,
    );
    const inCatalog = new Set(catalogRows.map((r) => r.catalog_item_id));
    const result = {};
    for (const cid of inCatalog) result[cid] = "in_catalog";
    for (const r of copyRows) {
      if (r.is_owned) result[r.catalog_item_id] = "owned";
      else if (r.is_wanted) result[r.catalog_item_id] = "wanted";
    }
    return result;
  } catch {
    return null;
  }
}

export default function TradePage() {
  const { slug } = useParams();
  const [trade, setTrade] = useState(null);
  const [ownership, setOwnership] = useState(null);
  const [viewerMode, setViewerMode] = useState("loading");
  const [error, setError] = useState("");

  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const [mobileCardsPerRow, setMobileCardsPerRow] = useMobileCardsPerRow(TRADE_PER_ROW_KEY);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const data = await fetchTradeData(slug);
        if (cancelled) return;
        setTrade(data);

        const cardIds = (data.payload?.cards || []).map((c) => c.catalog_item_id);
        if (!cardIds.length) {
          setViewerMode("unauth");
          return;
        }

        // Try admin path. Success → admin viewer with badge map.
        const adminMap = await tryAdminOwnership(cardIds);
        if (cancelled) return;
        if (adminMap) {
          setOwnership(adminMap);
          setViewerMode("admin");
          return;
        }

        // Guest path via OPFS.
        const guestMap = await probeGuestOwnership(cardIds);
        if (cancelled) return;
        if (guestMap && Object.keys(guestMap).length > 0) {
          setOwnership(guestMap);
          setViewerMode("guest");
          return;
        }

        setViewerMode("unauth");
      } catch (e) {
        if (cancelled) return;
        setError(e.message || "Failed to load trade.");
        setViewerMode("error");
      }
    }
    run();
    return () => { cancelled = true; };
  }, [slug]);

  const badgeFor = useMemo(() => {
    if (!ownership || viewerMode === "unauth" || viewerMode === "loading") return () => null;
    return (catalog_item_id) => ownership[catalog_item_id] || "not_in_catalog";
  }, [ownership, viewerMode]);

  if (viewerMode === "loading") {
    return <div style={styles.center}>Loading trade…</div>;
  }
  if (viewerMode === "error" || !trade) {
    return (
      <div style={styles.center}>
        <div style={{ marginBottom: 12 }}>{error || "Trade not found."}</div>
        <Link to="/library">← Back to library</Link>
      </div>
    );
  }

  const cards = trade.payload?.cards || [];
  const expiresLabel = trade.expires_at
    ? new Date(trade.expires_at).toLocaleDateString()
    : null;
  const createdLabel = trade.created_at
    ? new Date(trade.created_at).toLocaleDateString()
    : null;

  const gridStyle = isMobile
    ? { ...styles.grid, gridTemplateColumns: `repeat(${mobileCardsPerRow}, 1fr)`, gap: 8 }
    : { ...styles.grid, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" };

  // Flatten cards into one cell per visible side. Front always; back as a
  // separate cell when present so it sits next to the front in the same
  // grid row (matching the 4-col PDF layout the trade page replaces).
  const cells = [];
  for (const card of cards) {
    const status = badgeFor(card.catalog_item_id);
    cells.push({ card, side: "front", status });
    if (card.back_url) cells.push({ card, side: "back", status: null });
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>{trade.to_name ? `For ${trade.to_name}` : "Trade list"}</h1>
        <div style={styles.meta}>
          <div><strong>From:</strong> {trade.from_name}</div>
          {trade.to_name && <div><strong>To:</strong> {trade.to_name}</div>}
          {createdLabel && <div><strong>Created:</strong> {createdLabel}</div>}
          {expiresLabel && <div><strong>Expires:</strong> {expiresLabel}</div>}
        </div>
        {trade.notes && <div style={styles.notes}>{trade.notes}</div>}
        {viewerMode === "admin" && (
          <div style={styles.viewerBadge}>Viewing as admin — badges reflect your library.</div>
        )}
        {viewerMode === "guest" && (
          <div style={styles.viewerBadge}>Viewing as guest — badges reflect your local CollectCore data.</div>
        )}
        {isMobile && (
          <div style={styles.mobileControls}>
            <MobilePerRowStepper value={mobileCardsPerRow} onChange={setMobileCardsPerRow} />
          </div>
        )}
      </header>

      <div style={gridStyle}>
        {cells.map(({ card, side, status }, i) => {
          const url = side === "front" ? card.front_url : card.back_url;
          const tone = status ? BADGE_TONES[status] : null;
          const captionLines = (card.caption || []).slice();
          if (side === "back" && captionLines.length > 0) {
            captionLines[captionLines.length - 1] = captionLines[captionLines.length - 1] + " [back]";
          }
          return (
            <figure key={`${card.catalog_item_id}-${side}-${i}`} style={styles.cell}>
              <div style={styles.imageWrap}>
                <img src={url} alt="" loading="lazy" style={styles.image} />
                {tone && (
                  <span
                    style={{ ...styles.badge, background: tone.bg, color: tone.fg }}
                    title={BADGE_LABELS[status]}
                  >
                    {tone.label}
                  </span>
                )}
              </div>
              {captionLines.length > 0 && (
                <figcaption style={styles.caption}>
                  {captionLines.map((line, idx) => (
                    <div key={idx} style={styles.captionLine}>{line}</div>
                  ))}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 16px 64px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  center: { padding: 48, textAlign: "center" },
  header: {
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: 16,
    marginBottom: 24,
  },
  title: { margin: "0 0 8px", fontSize: 24 },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 24px",
    fontSize: 14,
    color: "#374151",
  },
  notes: {
    marginTop: 12,
    padding: "10px 12px",
    background: "#f9fafb",
    borderLeft: "3px solid #d1d5db",
    fontSize: 14,
    whiteSpace: "pre-wrap",
  },
  viewerBadge: {
    marginTop: 12,
    fontSize: 12,
    color: "#6b7280",
    fontStyle: "italic",
  },
  mobileControls: {
    marginTop: 12,
    display: "flex",
    justifyContent: "flex-end",
  },
  grid: {
    display: "grid",
    gap: 16,
  },
  cell: { margin: 0 },
  imageWrap: { position: "relative", aspectRatio: "0.65", marginBottom: 6 },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    background: "#f3f4f6",
    borderRadius: 4,
  },
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    padding: "2px 6px",
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
  },
  caption: { fontSize: 12, lineHeight: 1.3, color: "#374151" },
  captionLine: { marginBottom: 1 },
};
