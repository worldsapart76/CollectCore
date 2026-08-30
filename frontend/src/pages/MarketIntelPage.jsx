import { useEffect, useState } from "react";
import { Button, Alert } from "../components/primitives";
import {
  listMarketComps, getMarketComps, listFxRates, setFxRate, backfillFxUsd,
  listCostTiers, updateCostTier, previewCostBasis, assignCostBasis, setItemBasis,
  listFeeComponents, createFeeComponent, updateFeeComponent,
  deleteFeeComponent, setOfferDiscount,
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

// Amounts in a marketplace's OWN currency. JPY and KRW have no minor unit, so
// ¥350 is stored as 350 — dividing by 100 and printing a dollar sign is how a
// Neokyo fee showed up as "$350.00". usd() above stays for the comp figures,
// which really are USD.
const SYMBOL = { USD: "$", JPY: "¥", KRW: "₩", EUR: "€", GBP: "£", CAD: "$" };

const money = (minor, currency, exponent) => {
  if (minor == null) return "—";
  const exp = exponent ?? 2;
  return `${SYMBOL[currency] || ""}${(minor / 10 ** exp).toFixed(exp)}`;
};

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

      <FeesPanel
        onError={setError}
        onChanged={async () => {
          setCards((await listMarketComps()).cards || []);
          if (selected) setDetail(await getMarketComps(selected));
        }}
      />
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
            {detail && (
              <CardDetail
                detail={detail}
                onChanged={async () => {
                  setDetail(await getMarketComps(selected));
                  setCards((await listMarketComps()).cards || []);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// Cost components, per marketplace and per side.
//
// Buying and selling are separate costs on the same marketplace: Mercari
// charges a seller to sell and charges a buyer a protection fee to buy. The
// earlier version had a single unlabelled set of fields that were implicitly
// seller-side, which was both wrong for a marketplace you buy on and unable to
// hold the real buy-side lines — PayPal, import duty, proxy service fees.
//
// Labels are seeded, amounts are not. Naming the real cost lines says what
// needs filling in without inventing a rate that changes and differs per
// account.
function FeeComponentRow({ c, currency, exponent, onError, refresh }) {
  const [busy, setBusy] = useState(false);

  async function editValue(field, label, asPct) {
    const current = asPct
      ? ((c.pct || 0) * 100).toFixed(1)
      : ((c.fixed_minor || 0) / 10 ** exponent).toFixed(exponent);
    const entered = prompt(
      `${c.label} — ${label}\n` +
        (asPct
          ? "Enter a percentage, e.g. 10 for 10%."
          : `Enter an amount in ${currency}, e.g. ${exponent === 0 ? "350" : "1.20"}.`),
      current
    );
    if (entered == null) return;
    const n = Number(entered);
    if (!Number.isFinite(n) || n < 0) return onError("Enter a non-negative number");
    if (asPct && n >= 100) return onError("Enter less than 100%.");
    setBusy(true);
    try {
      await updateFeeComponent(c.component_id, {
        [field]: asPct ? n / 100 : Math.round(n * 10 ** exponent),
      });
      await refresh();
    } catch (e) {
      onError(e.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove "${c.label}"?`)) return;
    setBusy(true);
    try {
      await deleteFeeComponent(c.component_id);
      await refresh();
    } catch (e) {
      onError(e.message || "Failed to remove");
    } finally {
      setBusy(false);
    }
  }

  const btn = {
    border: "1px solid #ddd", borderRadius: 3, background: "#fff",
    padding: "1px 6px", cursor: "pointer", fontSize: 12, minWidth: 54,
  };

  return (
    <tr style={{ borderTop: "1px solid #f0f0f0" }}>
      <td style={{ padding: "3px 6px" }}>{c.label}</td>
      <td style={{ padding: "3px 6px", textAlign: "right" }}>
        <button
          disabled={busy}
          onClick={() => editValue("pct", "percentage", true)}
          style={{ ...btn, color: c.pct ? "#111" : "#bbb" }}
        >
          {c.pct ? `${(c.pct * 100).toFixed(1)}%` : "—"}
        </button>
      </td>
      <td style={{ padding: "3px 6px", textAlign: "right" }}>
        <button
          disabled={busy}
          onClick={() => editValue("fixed_minor", "fixed amount", false)}
          style={{ ...btn, color: c.fixed_minor ? "#111" : "#bbb" }}
        >
          {c.fixed_minor ? money(c.fixed_minor, currency, exponent) : "—"}
        </button>
      </td>
      <td style={{ padding: "3px 6px", textAlign: "right", width: 24 }}>
        <button
          disabled={busy}
          onClick={remove}
          title="Remove this cost line"
          style={{ border: "none", background: "transparent", color: "#bbb", cursor: "pointer" }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function FeeSide({ market, side, onError, refresh }) {
  const model = market[side];
  const comps = model.components || [];
  const cur = market.currency;
  const exp = market.minor_exponent ?? 2;

  async function add() {
    const label = prompt(
      `New ${side === "buy" ? "buying" : "selling"} cost on ${market.marketplace_name}.\n` +
        "e.g. PayPal fee, import duty, insurance."
    );
    if (!label?.trim()) return;
    try {
      await createFeeComponent({
        marketplace_code: market.marketplace_code,
        side,
        label: label.trim(),
      });
      await refresh();
    } catch (e) {
      onError(e.message || "Failed to add");
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 2 }}>
        {side === "buy" ? "Buying here" : "Selling here"}
        <span style={{ fontWeight: "normal", color: "#666" }}>
          {" "}— {side === "buy" ? "what a purchase costs" : "what a sale nets"}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {comps.map((c) => (
            <FeeComponentRow
              key={c.component_id}
              c={c}
              currency={cur}
              exponent={exp}
              onError={onError}
              refresh={refresh}
            />
          ))}
          {!comps.length && (
            <tr>
              <td colSpan={4} style={{ padding: "3px 6px", color: "#999", fontSize: 12 }}>
                nothing set
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Button size="sm" onClick={add} style={{ marginTop: 4 }}>
        + cost line
      </Button>
    </div>
  );
}

function FeesPanel({ onError, onChanged }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);

  async function refresh() {
    const d = await listFeeComponents();
    setRows(d.marketplaces || []);
    await onChanged();
  }

  useEffect(() => {
    if (!open || rows) return;
    listFeeComponents()
      .then((d) => setRows(d.marketplaces || []))
      .catch((e) => onError(e.message || "Failed to load fees"));
  }, [open, rows, onError]);

  async function editOffer(m) {
    const entered = prompt(
      `${m.marketplace_name} — how far below the ask buyers typically settle.\n` +
        "Enter a percentage, e.g. 10 for 10%.\n\n" +
        "This is NOT deducted from a sold comp — sold prices are already what " +
        "buyers paid. It is how far above a target you must list to still clear it.",
      ((m.offer_discount_pct || 0) * 100).toFixed(1)
    );
    if (entered == null) return;
    const n = Number(entered);
    if (!Number.isFinite(n) || n < 0 || n >= 100) return onError("Enter 0–99.");
    try {
      await setOfferDiscount(m.marketplace_code, n / 100);
      await refresh();
    } catch (e) {
      onError(e.message || "Failed to save");
    }
  }

  const anySet = rows?.some((m) => m.buy?.configured || m.sell?.configured);

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
        <strong>Fees &amp; shipping</strong>
        <span style={{ color: "#666" }}>what a sale nets, what a purchase costs</span>
        {rows && !anySet && (
          <span style={{ marginLeft: "auto", color: "#b45309", fontSize: 12 }}>
            not set — figures are gross
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid #eee" }}>
          {!rows && <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>}
          {rows?.map((m) => (
            <div key={m.marketplace_code} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>{m.marketplace_name}</strong>
                <span style={{ color: "#999", fontSize: 11 }}>
                  amounts in {m.currency}
                </span>
                <button
                  onClick={() => editOffer(m)}
                  title="How far below an ask buyers settle. Pads the list price; never deducted from a comp."
                  style={{
                    marginLeft: "auto", border: "1px solid #ddd", borderRadius: 3,
                    background: "#fff", padding: "1px 6px", cursor: "pointer", fontSize: 12,
                  }}
                >
                  offer gap {((m.offer_discount_pct || 0) * 100).toFixed(0)}%
                </button>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <FeeSide market={m} side="buy" onError={onError} refresh={refresh} />
                <FeeSide market={m} side="sell" onError={onError} refresh={refresh} />
              </div>
              {m[m.side === "buy" ? "buy" : "sell"]?.fx_missing && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  No {m.currency} exchange rate on file — these cannot be converted to
                  USD yet, so they are left out rather than counted as zero.
                </div>
              )}
            </div>
          ))}
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

// What you'd clear on this card, against what it cost.
//
// Margin is computed against the SOLD median for the same reason the headline
// is: active asks are what sellers hope for. Pricing a margin off an ask would
// flatter every card on the page.
//
// The estimate is labelled everywhere it appears. On a blended basis an
// individual card's margin is noise -- only the aggregate is sound -- so the
// number must never read as measured.
// Where a proposed list price stands among the listings competing with it now.
//
// This is the sanity check for a RARE card: comp volume can be genuinely thin,
// so gating on sold count would go quiet on exactly the cards most in need of
// a price. Ask-vs-ask works regardless of how many have sold.
//
// It reports the standing and stops there. "Undercuts everything" is good news
// on a card you want gone and bad news on one you do not, and the app has no
// business deciding which.
function AskStanding({ vsActive }) {
  if (!vsActive || vsActive.list_cents == null) return null;

  if (!vsActive.n_active) {
    return (
      <span style={{ color: "#666" }} title="No live competition to price against.">
        nothing else listed right now
      </span>
    );
  }

  const { cheaper, pricier, n_active: n, standing, active_min, active_max } = vsActive;
  const tone =
    standing === "undercuts_all" ? "#b45309"
      : standing === "above_all" ? "#b91c1c"
        : "#15803d";
  const text =
    standing === "undercuts_all"
      ? `cheapest of ${n + 1} — others start at ${usd(active_min)}`
      : standing === "above_all"
        ? `priciest of ${n + 1} — others top out at ${usd(active_max)}`
        : `${cheaper} cheaper, ${pricier} pricier of ${n} listed`;

  return (
    <span
      style={{ color: tone }}
      title={`Current asking prices: ${usd(active_min)}–${usd(active_max)} across ${n} listing(s).`}
    >
      {text}
    </span>
  );
}

function BasisLine({ itemId, basis, soldMedian, net, fees, vsActive, onChanged }) {
  const [busy, setBusy] = useState(false);

  async function edit() {
    const current = basis ? (basis.cost_cents / 100).toFixed(2) : "";
    const entered = prompt(
      "Cost for this card in USD.\n" +
      "Leave blank to clear it and fall back to the tier sweep.",
      current
    );
    if (entered == null) return;
    const trimmed = entered.trim();
    setBusy(true);
    try {
      if (trimmed === "") {
        await setItemBasis(itemId, {});
      } else {
        const dollars = Number(trimmed);
        if (!Number.isFinite(dollars) || dollars < 0) {
          throw new Error("Amount must be a non-negative number");
        }
        await setItemBasis(itemId, { cost_cents: Math.round(dollars * 100) });
      }
      await onChanged();
    } catch (e) {
      alert(e.message || "Failed to save basis");
    } finally {
      setBusy(false);
    }
  }

  const margin =
    basis && soldMedian != null ? soldMedian - basis.cost_cents : null;

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "6px 10px", marginBottom: 10, borderRadius: 4,
        background: "#f7f7f7", fontSize: 13,
      }}
    >
      {basis ? (
        <>
          <span>
            cost <strong>{usd(basis.cost_cents)}</strong>
            <span style={{ color: "#666" }}>
              {basis.source === "manual"
                ? " (set by hand)"
                : basis.tier_name
                  ? ` (${basis.tier_name})`
                  : ""}
            </span>
          </span>
          {net?.margin_vs_basis != null ? (
            <span style={{ color: net.margin_vs_basis >= 0 ? "#15803d" : "#b91c1c" }}>
              margin <strong>{usd(net.margin_vs_basis)}</strong>
              <span style={{ color: "#666" }}>
                {" "}— sells {usd(soldMedian)}, you keep {usd(net.sold_median_net)}
              </span>
            </span>
          ) : margin != null ? (
            <span style={{ color: margin >= 0 ? "#15803d" : "#b91c1c" }}>
              margin <strong>{usd(margin)}</strong>
              <span style={{ color: "#666" }}> vs sold median {usd(soldMedian)}</span>
            </span>
          ) : (
            <span style={{ color: "#666" }}>no sales yet — margin unknown</span>
          )}
          {net?.list_to_net != null && (
            <span
              title="List above your target: buyers negotiate down from the ask, and sold prices already reflect that."
              style={{ color: "#1d4ed8" }}
            >
              list at <strong>{usd(net.list_to_net)}</strong>
            </span>
          )}
          <AskStanding vsActive={vsActive} />
          {fees && !fees.configured && (
            <span
              title="No fees or shipping set for this marketplace, so these figures are gross."
              style={{
                fontSize: 10, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3,
                background: "#e5e7eb", color: "#374151",
              }}
            >
              GROSS — FEES NOT SET
            </span>
          )}
          {basis.estimated && (
            <span
              title="Blended estimate from a cost tier. Sound in aggregate, noisy per card."
              style={{
                fontSize: 10, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3,
                background: "#fde68a", color: "#78350f",
              }}
            >
              ESTIMATED
            </span>
          )}
        </>
      ) : (
        <span style={{ color: "#666" }}>
          No cost basis — assign the tiers above, or set one here.
        </span>
      )}
      <Button size="sm" disabled={busy} onClick={edit} style={{ marginLeft: "auto" }}>
        {basis ? "Edit cost" : "Set cost"}
      </Button>
    </div>
  );
}

function CardDetail({ detail, onChanged }) {
  const series = detail.series || [];
  const activeVals = series.filter((r) => r.listing_state === "active" && r.price_usd != null).map((r) => r.price_usd);
  const soldVals = series.filter((r) => r.listing_state === "sold" && r.price_usd != null).map((r) => r.price_usd);
  const scaleMax = Math.max(...activeVals, ...soldVals, 1);

  const activeStats = quartiles(activeVals);
  const soldStats = quartiles(soldVals);

  return (
    <div>
      <BasisLine
        itemId={detail.item_id}
        basis={detail.basis}
        soldMedian={soldStats?.median ?? null}
        net={detail.net}
        fees={detail.fees}
        vsActive={detail.vs_active}
        onChanged={onChanged}
      />

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
