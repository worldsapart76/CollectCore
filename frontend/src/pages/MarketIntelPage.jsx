import { useEffect, useState } from "react";
import { Button, Alert } from "../components/primitives";
import {
  listMarketComps, getMarketComps, listFxRates, setFxRate, backfillFxUsd,
  listCostTiers, updateCostTier, previewCostBasis, assignCostBasis,
} from "../api";

// Price comps from the browser-extension captures.
// Design: docs/photocard_market_intel_plan.md.
//
// Two panels, matching the rest of the app: card list on the left, the
// selected card's evidence on the right.
//
// The headline is deliberately the SOLD median, not the active one. Active
// asks are what sellers hope for; sold is what the market actually paid, and
// on real data the two barely overlap.

const usd = (cents) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

function quartiles(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const at = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: v[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: v[v.length - 1] };
}

// A single row showing where the mass of a distribution sits. Min/max alone is
// useless when the spread is 5x — the quartile band is the information.
function Spread({ label, stats, scaleMax, color }) {
  if (!stats) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0" }}>
        <span style={{ width: 54, fontSize: 12, color: "#666" }}>{label}</span>
        <span style={{ fontSize: 12, color: "#999" }}>no data</span>
      </div>
    );
  }
  const pct = (c) => `${Math.max(0, Math.min(100, (c / scaleMax) * 100))}%`;
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ width: 54, fontSize: 12, color: "#666" }}>{label}</span>
        <strong style={{ fontSize: 15, color }}>{usd(stats.median)}</strong>
        <span style={{ fontSize: 12, color: "#666" }}>
          median · n={stats.n} · {usd(stats.min)}–{usd(stats.max)}
        </span>
      </div>
      <div style={{ position: "relative", height: 8, background: "#f0f0f0", borderRadius: 4, marginLeft: 62 }}>
        <div
          style={{
            position: "absolute", left: pct(stats.p25),
            width: `calc(${pct(stats.p75)} - ${pct(stats.p25)})`,
            top: 0, bottom: 0, background: color, opacity: 0.35, borderRadius: 4,
          }}
        />
        <div style={{ position: "absolute", left: pct(stats.median), top: -2, bottom: -2, width: 2, background: color }} />
      </div>
    </div>
  );
}

export default function MarketIntelPage() {
  const [cards, setCards] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [fx, setFx] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMarketComps()
      .then((d) => setCards(d.cards || []))
      .catch((e) => setError(e.message || "Failed to load comps"));
    listFxRates().then(setFx).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    getMarketComps(selected)
      .then(setDetail)
      .catch((e) => setError(e.message || "Failed to load card"));
  }, [selected]);

  async function handleAddRate(currency) {
    const entered = prompt(`USD per 1 ${currency} (e.g. 0.0068 for JPY):`);
    if (!entered) return;
    const rate = Number(entered);
    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Rate must be a positive number");
      return;
    }
    setBusy(true);
    try {
      await setFxRate({ currency, usdPerUnit: rate });
      // Captures are never blocked on a missing rate, so anything seen before
      // now has no USD value until this fills it in.
      await backfillFxUsd();
      setFx(await listFxRates());
      setCards((await listMarketComps()).cards || []);
      if (selected) setDetail(await getMarketComps(selected));
    } catch (e) {
      setError(e.message || "Failed to save rate");
    } finally {
      setBusy(false);
    }
  }

  const missingRates = fx?.missing || [];

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 4px" }}>Market</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#666" }}>
        Price comps from listings captured with the browser extension.
      </p>

      {error && <Alert tone="error" style={{ marginBottom: 12 }}>{error}</Alert>}

      {missingRates.length > 0 && (
        <Alert tone="warn" style={{ marginBottom: 12 }}>
          No exchange rate on file for {missingRates.join(", ")} — captures in
          {missingRates.length > 1 ? " those currencies are" : " that currency is"}{" "}
          recorded but left out of comps until a rate exists.{" "}
          {missingRates.map((c) => (
            <Button key={c} size="sm" disabled={busy} onClick={() => handleAddRate(c)} style={{ marginLeft: 6 }}>
              Set {c} rate
            </Button>
          ))}
        </Alert>
      )}

      <CostBasisPanel onError={setError} />

      {cards === null && <div style={{ color: "#666" }}>Loading…</div>}

      {cards?.length === 0 && (
        <Alert tone="info">
          No comps yet. Capture listings with the extension, associate them to
          cards, then press <strong>Sync</strong>.
        </Alert>
      )}

      {cards?.length > 0 && (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* Card list */}
          <div style={{ flex: "0 0 340px", maxHeight: "72vh", overflowY: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
            {cards.map((c) => {
              const active = c.n_active ? { min: c.active_usd_min, max: c.active_usd_max } : null;
              const sold = c.n_sold ? { min: c.sold_usd_min, max: c.sold_usd_max } : null;
              return (
                <button
                  key={c.item_id}
                  onClick={() => setSelected(c.item_id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                    border: "none", borderBottom: "1px solid #eee", cursor: "pointer",
                    background: selected === c.item_id ? "#eef6ff" : "#fff",
                  }}
                >
                  <div style={{ fontSize: 13, marginBottom: 2 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>
                    {sold ? `sold ${usd(sold.min)}–${usd(sold.max)} (${c.n_sold})` : "no sales"}
                    {" · "}
                    {active ? `asks ${usd(active.min)}–${usd(active.max)} (${c.n_active})` : "no asks"}
                    {c.n_unconverted > 0 && (
                      <span style={{ color: "#b45309" }}> · {c.n_unconverted} unconverted</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selected && <div style={{ color: "#666", fontSize: 13 }}>Select a card.</div>}
            {selected && !detail && <div style={{ color: "#666" }}>Loading…</div>}
            {detail && <CardDetail detail={detail} />}
          </div>
        </div>
      )}
    </div>
  );
}

// Cost basis for the sale pile.
//
// Scoped to trade + pending_outgoing on purpose: a card that was never owned
// has no basis, and a card being kept is a collecting cost, not a trading one.
//
// The preview is always on screen and the assign button is the only thing that
// writes. That ordering is the point — a bad rule sweeps expensive cards into
// the cheapest tier, and once written the mistake looks exactly like a correct
// assignment.
function CostBasisPanel({ onError }) {
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function refresh() {
    const [t, p] = await Promise.all([listCostTiers(), previewCostBasis()]);
    setTiers(t.tiers || []);
    setPreview(p);
  }

  // Load once, on first expand. Re-running when `tiers` lands is harmless --
  // the guard turns it into a no-op -- so the deps stay honest rather than
  // suppressed.
  useEffect(() => {
    if (!open || tiers) return;
    refresh().catch((e) => onError(e.message || "Failed to load cost basis"));
  }, [open, tiers, onError]);

  async function handleEditAmount(tier) {
    const entered = prompt(`Cost per card for "${tier.tier_name}" (USD):`,
      (tier.cost_cents / 100).toFixed(2));
    if (entered == null) return;
    const dollars = Number(entered);
    if (!Number.isFinite(dollars) || dollars < 0) {
      onError("Amount must be a non-negative number");
      return;
    }
    setBusy(true);
    try {
      // Derived on read — this reprices every card on the tier, no backfill.
      await updateCostTier(tier.cost_tier_id, { cost_cents: Math.round(dollars * 100) });
      await refresh();
      setNote(`${tier.tier_name} is now ${usd(Math.round(dollars * 100))} — every card on this tier repriced.`);
    } catch (e) {
      onError(e.message || "Failed to save tier");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign() {
    setBusy(true);
    try {
      const r = await assignCostBasis();
      await refresh();
      setNote(
        `Assigned ${r.cards_assigned} card${r.cards_assigned === 1 ? "" : "s"}.` +
        (r.manual_rows_preserved ? ` ${r.manual_rows_preserved} hand-set basis kept.` : "")
      );
    } catch (e) {
      onError(e.message || "Failed to assign");
    } finally {
      setBusy(false);
    }
  }

  const assignedTotal = (tiers || []).reduce((n, t) => n + (t.assigned_cards || 0), 0);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, marginBottom: 12 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 10px",
          background: "#fafafa", border: "none", borderRadius: 6, cursor: "pointer",
          textAlign: "left", fontSize: 13,
        }}
      >
        <span style={{ color: "#666" }}>{open ? "▾" : "▸"}</span>
        <strong>Cost basis</strong>
        <span style={{ color: "#666" }}>
          {preview
            ? `${preview.copies} copies for sale · ${usd(preview.total_cents)} estimated`
            : "what the sale pile cost"}
        </span>
        {tiers && assignedTotal === 0 && (
          <span style={{ marginLeft: "auto", color: "#b45309", fontSize: 12 }}>not assigned yet</span>
        )}
      </button>

      {open && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid #eee" }}>
          {!tiers && <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>}

          {tiers && preview && (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                Scope: cards held for <strong>{preview.scope.join(" / ")}</strong>.
                Era boundary {preview.era_cutoff} — on or before is older, after is current.
                Figures are <strong>estimates</strong>; a logged purchase will outrank them.
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#666", fontSize: 11 }}>
                    <th style={{ padding: "3px 6px" }}>Tier</th>
                    <th style={{ padding: "3px 6px", textAlign: "right" }}>Each</th>
                    <th style={{ padding: "3px 6px", textAlign: "right" }}>Copies</th>
                    <th style={{ padding: "3px 6px", textAlign: "right" }}>Subtotal</th>
                    <th style={{ padding: "3px 6px" }}>Example</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {preview.tiers.map((t) => (
                    <tr key={t.tier_code} style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "4px 6px" }}>{t.tier_name}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{usd(t.cost_cents)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{t.copies}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{usd(t.subtotal_cents)}</td>
                      <td style={{ padding: "4px 6px", color: "#666", fontSize: 11 }}>
                        {t.samples?.[0] || "—"}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            handleEditAmount(tiers.find((x) => x.tier_code === t.tier_code))
                          }
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #ddd", fontWeight: "bold" }}>
                    <td style={{ padding: "4px 6px" }}>Total</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: "normal", color: "#666" }}>
                      avg {usd(preview.avg_cents)}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{preview.copies}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>{usd(preview.total_cents)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <Button disabled={busy} onClick={handleAssign}>
                  {assignedTotal ? "Re-assign from rules" : "Assign to cards"}
                </Button>
                <span style={{ fontSize: 12, color: "#666" }}>
                  {assignedTotal
                    ? `${assignedTotal} card${assignedTotal === 1 ? "" : "s"} currently assigned.`
                    : "Nothing written yet — the table above is a dry run."}
                </span>
              </div>

              {note && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#15803d" }}>{note}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CardDetail({ detail }) {
  const series = detail.series || [];
  const activeVals = series.filter((r) => r.listing_state === "active" && r.price_usd != null).map((r) => r.price_usd);
  const soldVals = series.filter((r) => r.listing_state === "sold" && r.price_usd != null).map((r) => r.price_usd);
  const scaleMax = Math.max(...activeVals, ...soldVals, 1);

  const activeStats = quartiles(activeVals);
  const soldStats = quartiles(soldVals);

  return (
    <div>
      <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "10px 12px", marginBottom: 12 }}>
        <Spread label="Sold" stats={soldStats} scaleMax={scaleMax} color="#1f7a4d" />
        <Spread label="Asking" stats={activeStats} scaleMax={scaleMax} color="#6b7280" />

        {soldStats && activeStats && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#666" }}>
            Asks run {(activeStats.median / Math.max(soldStats.median, 1)).toFixed(1)}× the
            sold median. Anything above {usd(soldStats.max)} has never sold here.
          </p>
        )}
        {detail.unconverted > 0 && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b45309" }}>
            {detail.unconverted} sighting(s) excluded — no exchange rate on file.
          </p>
        )}
      </div>

      {/* The evidence. Shown with thumbnails on purpose: a statistic you cannot
          audit is one you will eventually stop trusting, and a mis-associated
          listing is only findable by eye. */}
      <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Listings ({series.length})</h4>
      <div style={{ maxHeight: "44vh", overflowY: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
        {series.map((r, i) => (
          <a
            key={i}
            href={r.listing_url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
              borderBottom: "1px solid #eee", textDecoration: "none", color: "inherit",
            }}
          >
            <img src={r.thumbnail_url} alt="" loading="lazy"
                 style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, background: "#f0f0f0" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.title_raw}
              </div>
              <div style={{ fontSize: 11, color: "#666" }}>
                {r.marketplace} · {r.item_condition || "—"} · {String(r.observed_at).slice(0, 10)}
                {r.currency !== "USD" && ` · ${r.price_cents} ${r.currency}`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{usd(r.price_usd)}</div>
              <div style={{ fontSize: 10, color: r.listing_state === "sold" ? "#1f7a4d" : "#6b7280" }}>
                {r.listing_state}
              </div>
            </div>
          </a>
        ))}
      </div>

      {detail.excluded_lots?.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>
            Excluded lots ({detail.excluded_lots.length})
          </h4>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#666" }}>
            Bundles containing this card. Kept out of the prices above — a
            multi-card lot's price is not this card's price — but real signal
            for what bundles go for.
          </p>
          <div style={{ border: "1px solid #ddd", borderRadius: 6 }}>
            {detail.excluded_lots.map((r, i) => (
              <a key={i} href={r.listing_url} target="_blank" rel="noreferrer"
                 style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px",
                          borderBottom: "1px solid #eee", textDecoration: "none", color: "inherit" }}>
                <img src={r.thumbnail_url} alt="" loading="lazy"
                     style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, background: "#f0f0f0" }} />
                <div style={{ minWidth: 0, flex: 1, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.title_raw}
                </div>
                <div style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>
                  {r.line_count} cards · {usd(r.price_cents)}
                  {r.line_count > 1 && ` · ${usd(Math.round(r.price_cents / r.line_count))}/card`}
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
