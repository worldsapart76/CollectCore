import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchTradeData, fetchTradeOwnership, probeAdminMode } from "../api";

// Public-facing trade page. Three viewer modes:
//   admin  → /admin/me 200s, fetch /admin/trade-ownership for badges
//   guest  → OPFS has guest_card_copies, query locally
//   unauth → no badges, plain styled grid
//
// Lazy-loads the guest sqlite path on demand so admin viewers (most common
// case in production) don't pull the sqlite-wasm chunk into the active
// session. The chunk is still emitted into the admin bundle so unauth
// viewers can use it, but it stays inert until the probe falls through.

const BADGE_LABELS = {
  owned:      "You own this card.",
  wanted:     "This card is on your wanted list.",
  in_catalog: "You do not own this card but it is not on your wanted list.",
  not_in_catalog: "Not yet in your catalog.",
};

const BADGE_TONES = {
  owned: { bg: "#16a34a", fg: "#fff" },
  wanted: { bg: "#2563eb", fg: "#fff" },
  in_catalog: { bg: "#6b7280", fg: "#fff" },
  not_in_catalog: { bg: "#a16207", fg: "#fff" },
};

async function probeGuestOwnership(catalogItemIds) {
  // Lazy import — only fetched when admin probe fails. Falls through to
  // null on any error (no OPFS, no catalog loaded, query failure) so the
  // page renders without badges instead of erroring.
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
    // Owned/wanted from guest's own copies.
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
    // Catalog presence — even without a copy row, if the card is in the
    // guest's local catalog mirror we want to badge "in catalog, no copy".
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
  const [ownership, setOwnership] = useState(null);  // null = unauth, {} = checked but empty
  const [viewerMode, setViewerMode] = useState("loading");  // 'loading' | 'admin' | 'guest' | 'unauth' | 'error'
  const [error, setError] = useState("");

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

        // 1. Admin probe.
        const isAdminViewer = await probeAdminMode();
        if (cancelled) return;
        if (isAdminViewer) {
          try {
            const map = await fetchTradeOwnership(cardIds);
            if (cancelled) return;
            setOwnership(map);
            setViewerMode("admin");
            return;
          } catch {
            // Treat lookup failure as no badges rather than erroring the page.
            setViewerMode("admin");
            setOwnership({});
            return;
          }
        }

        // 2. Guest probe via OPFS.
        const guestMap = await probeGuestOwnership(cardIds);
        if (cancelled) return;
        if (guestMap && Object.keys(guestMap).length > 0) {
          setOwnership(guestMap);
          setViewerMode("guest");
          return;
        }

        // 3. Unauthenticated viewer — render without badges.
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
    return (catalog_item_id) => {
      const status = ownership[catalog_item_id];
      if (status) return status;
      // Card present in trade but absent from viewer's library.
      return "not_in_catalog";
    };
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
      </header>

      <div style={styles.grid}>
        {cards.map((card) => {
          const status = badgeFor(card.catalog_item_id);
          return (
            <figure key={card.catalog_item_id} style={styles.cell}>
              <div style={styles.imageWrap}>
                <img src={card.front_url} alt="" loading="lazy" style={styles.image} />
                {status && (
                  <span style={{
                    ...styles.badge,
                    background: BADGE_TONES[status].bg,
                    color: BADGE_TONES[status].fg,
                  }} title={BADGE_LABELS[status]}>
                    {status === "owned"          ? "Owned"
                     : status === "wanted"        ? "Wanted"
                     : status === "in_catalog"    ? "Don't own"
                     : "Not in catalog"}
                  </span>
                )}
              </div>
              {card.caption && card.caption.length > 0 && (
                <figcaption style={styles.caption}>
                  {card.caption.map((line, i) => (
                    <div key={i} style={styles.captionLine}>{line}</div>
                  ))}
                </figcaption>
              )}
              {card.back_url && (
                <div style={styles.imageWrap}>
                  <img src={card.back_url} alt="" loading="lazy" style={styles.image} />
                </div>
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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
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
