import { useEffect, useState } from "react";
import { Button, Alert } from "../components/primitives";
import {
  getMarketGrid, getMarketComps, setListingOutcome,
  listMarketLots, getMarketLot, addLotLine, updateLotLine, deleteLotLine,
  deleteMarketListing, getMarketSettings, setMarketSettings,
  listFxRates, setFxRate, backfillFxUsd,
  listCostTiers, updateCostTier, previewCostBasis, assignCostBasis, setItemBasis,
  listFeeComponents, createFeeComponent, updateFeeComponent,
  deleteFeeComponent, setOfferDiscount, setBoxSize,
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

const EXPONENT = { USD: 2, JPY: 0, KRW: 0, EUR: 2, GBP: 2, CAD: 2 };

const money = (minor, currency, exponent) => {
  if (minor == null) return "—";
  const exp = exponent ?? EXPONENT[currency] ?? 2;
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

// The card grid — the front door of the market workspace.
//
// v1 was card-first: you had to already know which card to look up. Every real
// decision is about a listing, and the question people actually arrive with is
// "what in this pile is worth acting on". So the grid leads, sorted by the
// margin that answers it, and the per-card comp view becomes its drill-down.
//
// See docs/photocard_market_intel_plan.md -> v2, the market workspace.

// Rendered per source rather than as one number: nineteen Mercari comps two
// days old beside one Neokyo listing three weeks old is a different picture
// from "20 comps", and the overall figure hides the part that decides whether
// to trust it.
const SOURCE_INITIAL = { mercari_us: "M", neokyo: "N", pocamarket: "P", ebay: "E" };

function ageDays(iso) {
  if (!iso) return null;
  const then = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - then.getTime()) / 86400000));
}

function CompCell({ comps }) {
  if (!comps?.length) return <span style={{ color: "#bbb" }}>—</span>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {comps.map((s) => {
        const d = ageDays(s.last_seen);
        // Anything over a fortnight is quietly suspect: an "active" listing
        // that old may simply be gone, and the row would rank on a price
        // nobody can pay any more.
        const stale = d != null && d > 14;
        return (
          <span
            key={s.marketplace}
            title={`${s.marketplace}: ${s.n} sighting(s), newest ${s.last_seen || "?"}`}
            style={{ marginRight: 6, color: stale ? "#b45309" : "#666" }}
          >
            {SOURCE_INITIAL[s.marketplace] || s.marketplace[0].toUpperCase()}
            {s.n}
            {d != null && <span style={{ color: "#aaa" }}>·{d}d</span>}
          </span>
        );
      })}
    </span>
  );
}

// How long ago this card was last seen anywhere. The number that says whether
// the rest of the row can be trusted: a margin computed off a three-week-old
// ask is arithmetic about a listing that may well be gone.
function Seen({ iso }) {
  const d = ageDays(iso);
  if (d == null) return <span style={{ color: "#bbb" }}>—</span>;
  return (
    <span title={iso} style={{ color: d > 14 ? "#b45309" : "#666" }}>
      {d === 0 ? "today" : `${d}d`}
    </span>
  );
}

function Margin({ cents }) {
  if (cents == null) return <span style={{ color: "#bbb" }}>—</span>;
  const good = cents >= 0;
  return (
    <span style={{ color: good ? "#166534" : "#b91c1c" }}>
      {good ? "+" : "−"}
      {usd(Math.abs(cents))}
    </span>
  );
}

// Sorting puts nulls last in BOTH directions. A card with no margin is not
// "the worst margin" — it is an unknown, and letting unknowns win either end
// of the sort buries the rows the grid exists to surface.
function compare(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string") return dir * av.localeCompare(bv);
  return dir * (av - bv);
}

// The card's name arrives in three pieces as well as composed, because each is
// a question the grid has to be able to answer on its own: "everything from
// Rock Star", "every POB", "everything of Hyunjin's". None of those is
// expressible by sorting one composed string.
const COLUMNS = [
  { key: "wanted", label: "★", title: "on your wanted list", align: "center" },
  { key: "members", label: "member", align: "left" },
  { key: "origin", label: "origin", align: "left" },
  { key: "version", label: "version", align: "left" },
  { key: "held", label: "own", title: "copies held — owned, trade or pending outgoing" },
  { key: "cost_cents", label: "cost", title: "what it cost you — card-level estimate" },
  { key: "buy_single_cents", label: "buy", title: "cheapest landed, single-card listing" },
  { key: "buy_lot_cents", label: "via lot", title: "cheapest landed per card inside a lot — buying it means buying the whole lot" },
  { key: "sell_price_cents", label: "sell", title: "median sell price — what it actually sold for" },
  { key: "net_proceeds_cents", label: "net", title: "sell price minus selling fees — what you keep" },
  { key: "flip_profit_cents", label: "flip", title: "net proceeds − cost: margin on what you already hold" },
  { key: "resell_profit_cents", label: "arb", title: "net proceeds − cheapest buy: margin on what you could source" },
  { key: "last_seen", label: "seen", title: "the newest observation of this card, from any source" },
  { key: "comps", label: "comps", sortable: false, align: "left" },
];

const TEXT_COLUMNS = new Set(["members", "origin", "version", "label"]);

function MarketGrid({ cards, selected, onSelect, onOpen }) {
  const [q, setQ] = useState("");
  const [onlySold, setOnlySold] = useState(false);
  const [onlyBuy, setOnlyBuy] = useState(false);
  const [onlyWanted, setOnlyWanted] = useState(false);
  const [onlyHeld, setOnlyHeld] = useState(false);
  // Best opportunity first, because "what should I act on" is the question the
  // grid exists to answer. Anything else is a click away.
  const [sort, setSort] = useState({ key: "resell_profit_cents", dir: -1 });

  // Flattened once so sorting and filtering both read plain numbers rather
  // than reaching into nested objects on every comparison.
  const rows = (cards || []).map((c) => ({
    ...c,
    cost_cents: c.cost?.cost_cents ?? null,
    buy_single_cents: c.buy_single?.per_card_cents ?? null,
    buy_lot_cents: c.buy_lot?.per_card_cents ?? null,
  }));

  const shown = rows
    .filter((c) => {
      if (onlySold && !c.n_sold) return false;
      if (onlyBuy && !c.buy_single && !c.buy_lot) return false;
      if (onlyWanted && !c.wanted) return false;
      if (onlyHeld && !c.held) return false;
      if (!q.trim()) return true;
      const hay = (c.label || "").toLowerCase();
      // Every word must match, so adding words narrows — the same rule as the
      // extension's picker. A search behaving differently in two places is
      // worse than either behaviour on its own.
      return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
    })
    .sort((a, b) => compare(a, b, sort.key, sort.dir) || a.item_id - b.item_id);

  function sortBy(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: -s.dir }
        // Names read A-Z on first click; every other column is "best first",
        // which for a margin, a count or a date means largest.
        : { key, dir: TEXT_COLUMNS.has(key) ? 1 : -1 }
    );
  }

  const chk = {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 11, color: "#444", cursor: "pointer", whiteSpace: "nowrap",
  };
  const th = {
    padding: "4px 6px", textAlign: "right", fontSize: 11, color: "#444",
    borderBottom: "1px solid #ddd", cursor: "pointer", whiteSpace: "nowrap",
    background: "#fafafa", position: "sticky", top: 0,
  };
  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter cards…"
          style={{ flex: "0 0 240px", padding: "4px 6px", fontSize: 13,
                   border: "1px solid #ddd", borderRadius: 4 }}
        />
        <label style={chk}>
          <input type="checkbox" checked={onlyBuy}
                 onChange={(e) => setOnlyBuy(e.target.checked)} />
          buyable now
        </label>
        <label style={chk}>
          <input type="checkbox" checked={onlySold}
                 onChange={(e) => setOnlySold(e.target.checked)} />
          has sold comps
        </label>
        <label style={chk}>
          <input type="checkbox" checked={onlyWanted}
                 onChange={(e) => setOnlyWanted(e.target.checked)} />
          wanted
        </label>
        <label style={chk}>
          <input type="checkbox" checked={onlyHeld}
                 onChange={(e) => setOnlyHeld(e.target.checked)} />
          I hold one
        </label>
        <span style={{ fontSize: 11, color: "#666", marginLeft: "auto" }}>
          {/* The true total, always. A count that silently means "the visible
              page" is how "60 match" ended up on screen for every search in
              the extension. */}
          {shown.length === rows.length
            ? `${rows.length.toLocaleString()} cards`
            : `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} cards`}
        </span>
      </div>

      <div style={{ maxHeight: "62vh", overflow: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={col.sortable === false ? undefined : () => sortBy(col.key)}
                  style={{
                    ...th,
                    textAlign: col.align || "right",
                    cursor: col.sortable === false ? "default" : "pointer",
                  }}
                >
                  {col.label}
                  {sort.key === col.key && (sort.dir === -1 ? " ▾" : " ▴")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 10, color: "#666" }}>
                  Nothing matches those filters.
                </td>
              </tr>
            )}
            {shown.map((c) => (
              <tr
                key={c.item_id}
                onClick={() => onSelect(c.item_id)}
                onDoubleClick={() => onOpen(c.item_id)}
                style={{
                  borderTop: "1px solid #f0f0f0", cursor: "pointer",
                  background: selected === c.item_id ? "#eef6ff" : "transparent",
                  // The browser selects the row's text on a double-click
                  // otherwise, so every open leaves a blue smear behind it.
                  userSelect: "none",
                }}
              >
                <td style={{ ...td, textAlign: "center" }}>
                  {c.wanted
                    ? <span title="on your wanted list" style={{ color: "#b45309" }}>★</span>
                    : <span style={{ color: "#eee" }}>·</span>}
                </td>
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  {c.members || <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  {c.origin || <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  {c.version || <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={td}>{c.held || <span style={{ color: "#bbb" }}>—</span>}</td>
                <td style={td}>
                  {c.cost_cents == null ? <span style={{ color: "#bbb" }}>—</span> : (
                    <span title={`${c.cost.tier_name || c.cost.source || "manual"} — estimated`}>
                      {usd(c.cost_cents)}
                    </span>
                  )}
                </td>
                <td style={td}>
                  {c.buy_single_cents == null
                    ? <span style={{ color: "#bbb" }}>—</span>
                    : usd(c.buy_single_cents)}
                </td>
                <td style={td}>
                  {c.buy_lot_cents == null ? <span style={{ color: "#bbb" }}>—</span> : (
                    // The commitment travels with the number: acting on a
                    // $12.50 per-card figure inside an 8-card lot costs $118.
                    <span title={`inside a ${c.buy_lot.line_count}-card lot — buying it costs ${usd(c.buy_lot.landed_cents)} landed`}>
                      {usd(c.buy_lot_cents)}
                      <span style={{ color: "#999" }}>/{c.buy_lot.line_count}</span>
                    </span>
                  )}
                </td>
                <td style={td}>
                  {c.sell_price_cents == null ? <span style={{ color: "#bbb" }}>—</span> : (
                    <span title={`median of ${c.n_sold} sold on ${c.sell_marketplace}`}>
                      {usd(c.sell_price_cents)}
                      {/* A margin built on two comps is not the claim a margin
                          built on nineteen is. */}
                      <span style={{ color: c.n_sold < 3 ? "#b45309" : "#aaa" }}>
                        {" "}({c.n_sold})
                      </span>
                    </span>
                  )}
                </td>
                <td style={td}>
                  {c.net_proceeds_cents == null ? <span style={{ color: "#bbb" }}>—</span> : (
                    <span title={`after ${c.sell_marketplace} selling fees`}>
                      {usd(c.net_proceeds_cents)}
                    </span>
                  )}
                </td>
                <td style={td}><Margin cents={c.flip_profit_cents} /></td>
                <td style={td}>
                  <Margin cents={c.resell_profit_cents} />
                  {c.arb_via_lot && (
                    <span title="cheapest route is inside a lot" style={{ color: "#999" }}> ᴸ</span>
                  )}
                </td>
                <td style={td}><Seen iso={c.last_seen} /></td>
                <td style={{ ...td, textAlign: "left" }}><CompCell comps={c.comps} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── The lot analyzer ─────────────────────────────────
//
// A card-first view cannot answer "is this 8-card lot worth $118?" — that
// question is about the whole listing at once. This is the view that can.
//
// See docs/photocard_market_intel_plan.md -> v2, the lot analyzer.

// Where a line's value came from, said out loud. A card priced off its era's
// median is a guess wearing the same typeface as a card priced off nineteen
// real comps, and the difference decides how much weight the margin can carry.
const VALUE_SOURCE = {
  sold: { text: "comps", color: "#166534" },
  era: { text: "est.", color: "#b45309" },
  manual: { text: "set", color: "#1d4ed8" },
  none: { text: "", color: "#999" },
};

function LotList({ lots, selected, onSelect }) {
  const th = {
    padding: "4px 6px", textAlign: "right", fontSize: 11, color: "#444",
    borderBottom: "1px solid #ddd", background: "#fafafa", whiteSpace: "nowrap",
  };
  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, overflow: "auto",
                  maxHeight: "34vh" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>lot</th>
            <th style={th} title="cards in the listing, counting quantity">cards</th>
            <th style={th} title="identified cards still to be entered">unknown</th>
            <th style={th} title="asking price in the listing's own currency">ask</th>
            <th style={th} title="all in: price plus this marketplace's buying costs">landed</th>
            <th style={th} title="sum of every line's value, where a value is known">value</th>
            <th style={th} title="known value less landed cost">margin</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr
              key={l.listing_id}
              onClick={() => onSelect(l.listing_id)}
              style={{
                borderTop: "1px solid #f0f0f0", cursor: "pointer",
                background: selected === l.listing_id ? "#eef6ff" : "transparent",
              }}
            >
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                {l.delisted_at && (
                  <span title="no longer listed" style={{ color: "#999" }}>✕ </span>
                )}
                {l.title || `listing ${l.listing_id}`}
                <span style={{ color: "#999" }}> · {l.marketplace}</span>
              </td>
              <td style={td}>{l.units}</td>
              <td style={{ ...td, color: l.unidentified_units ? "#b45309" : "#bbb" }}>
                {l.unidentified_units || "—"}
              </td>
              <td style={td}>{money(l.price_cents, l.currency)}</td>
              <td style={td}>{usd(l.landed_cents)}</td>
              <td style={td}>{usd(l.known_value_cents)}</td>
              <td style={td}><Margin cents={l.margin_cents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LotLineRow({ lot, line, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const src = VALUE_SOURCE[line.value_source] || VALUE_SOURCE.none;
  // Card lines came out of the capture and its picker; a line added here is
  // one the analyzer owns and can take away again.
  const removable = line.line_type !== "card";

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e.message || "Failed to update the line");
    } finally {
      setBusy(false);
    }
  }

  function editValue() {
    const now = line.value_cents == null ? "" : (line.value_cents / 100).toFixed(2);
    const entered = prompt(
      `Value of one "${line.label}", in dollars, AFTER selling fees.\n` +
      `Leave empty to go back to the derived value.`, now);
    if (entered === null) return;
    if (!entered.trim()) {
      if (line.value_source !== "manual") return;
      return run(() => updateLotLine(lot.listing_id, line.line_id,
                                     { clear_value: true }));
    }
    const dollars = Number(entered);
    if (!Number.isFinite(dollars) || dollars < 0) {
      onError("Value must be a number, and not negative.");
      return;
    }
    run(() => updateLotLine(lot.listing_id, line.line_id,
                            { value_cents: Math.round(dollars * 100) }));
  }

  function toggleDisposition() {
    run(() => updateLotLine(lot.listing_id, line.line_id,
                            { disposition: line.disposition === "keep" ? "flip" : "keep" }));
  }

  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };
  return (
    <tr style={{ borderTop: "1px solid #f0f0f0", opacity: busy ? 0.5 : 1 }}>
      <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
        {line.wanted && <span title="on your wanted list" style={{ color: "#b45309" }}>★ </span>}
        {line.label}
        {line.qty > 1 && <span style={{ color: "#999" }}> ×{line.qty}</span>}
        {line.line_type !== "card" && (
          <span style={{ color: "#999", fontSize: 11 }}> ({line.line_type.replace("_", "-")})</span>
        )}
      </td>
      <td style={td}>
        <span
          onClick={busy ? undefined : editValue}
          title={line.value_source === "sold"
            ? `median of ${line.n_sold} sold, net of fees — click to override`
            : line.value_source === "era"
              ? "no comps for this card; the median of its era stands in — click to set one"
              : line.value_source === "manual"
                ? "set by hand — click to change, clear to go back to deriving"
                : "no value: its share of the cost is being carried by the other lines"}
          style={{ cursor: "pointer", textDecoration: "underline dotted",
                   color: line.value_cents == null ? "#b45309" : "inherit" }}
        >
          {line.value_cents == null ? "set value…" : usd(line.value_cents)}
        </span>
        {src.text && (
          <span style={{ color: src.color, fontSize: 10 }}> {src.text}</span>
        )}
      </td>
      <td style={td}>{usd(line.alloc_cents)}</td>
      <td style={td}><Margin cents={line.margin_cents} /></td>
      <td style={{ ...td, textAlign: "center" }}>
        <span
          onClick={busy ? undefined : toggleDisposition}
          title={line.disposition_source === "library"
            ? "from the card's library status — click to override"
            : "set by hand"}
          style={{
            cursor: "pointer", fontSize: 11, padding: "1px 6px", borderRadius: 3,
            border: "1px solid #ddd",
            background: line.disposition === "keep" ? "#fef3c7" : "#f3f4f6",
            fontStyle: line.disposition_source === "library" ? "italic" : "normal",
          }}
        >
          {line.disposition}
        </span>
      </td>
      <td style={{ ...td, width: 24 }}>
        {removable && (
          <span
            onClick={busy ? undefined : () => run(
              () => deleteLotLine(lot.listing_id, line.line_id))}
            title="remove this line" style={{ cursor: "pointer", color: "#999" }}
          >
            ✕
          </span>
        )}
      </td>
    </tr>
  );
}

// The line that actually decides it: what the cards you are keeping really
// cost, against what buying them separately would. Every other figure on the
// screen is an input to this one.
function Residual({ lot }) {
  const r = lot.residual;
  const box = {
    marginTop: 10, padding: "8px 10px", borderRadius: 6,
    background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 13,
  };

  if (!r.keep_units) {
    return (
      <div style={box}>
        Nothing marked <strong>keep</strong>, so this is a pure flip:{" "}
        <strong>{usd(lot.known_value_cents)}</strong> of known value against{" "}
        <strong>{usd(lot.landed_cents)}</strong> landed —{" "}
        <Margin cents={lot.margin_cents} />.
      </div>
    );
  }

  return (
    <div style={box}>
      Keep <strong>{r.keep_units}</strong>, flip <strong>{r.flip_units}</strong> →
      flips net <strong>{usd(r.flip_net_cents)}</strong>, the lot costs{" "}
      <strong>{usd(lot.landed_cents)}</strong>, so the {r.keep_units} kept cost{" "}
      <strong>{usd(r.kept_cost_cents)}</strong>
      {r.keep_units > 1 && <> ({usd(r.kept_per_unit_cents)} each)</>}.
      {r.lot_advantage_cents != null ? (
        <>
          {" "}Buying them separately: <strong>{usd(r.separate_cost_cents)}</strong>.{" "}
          <strong style={{ color: r.lot_advantage_cents >= 0 ? "#166534" : "#b91c1c" }}>
            The lot is {usd(Math.abs(r.lot_advantage_cents))}{" "}
            {r.lot_advantage_cents >= 0 ? "better" : "worse"}.
          </strong>
        </>
      ) : (
        <span style={{ color: "#b45309" }}>
          {" "}
          {/* Partial totals read as whole answers, and this one would
              understate the alternative — the direction that talks you into
              the lot. */}
          {r.keep_units_unpriced} of the kept {r.keep_units_unpriced === 1 ? "card has" : "cards have"}{" "}
          no separate listing captured, so there is nothing to compare against yet.
        </span>
      )}
      {r.flip_unvalued_units > 0 && (
        <span style={{ color: "#b45309" }}>
          {" "}{r.flip_unvalued_units} flipped{" "}
          {r.flip_unvalued_units === 1 ? "line has" : "lines have"} no value set,
          so the flip total is understated.
        </span>
      )}
    </div>
  );
}

function LotAnalyzer({ lot, onChanged, onDeleted, onError }) {
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(e.message || "Failed to add the line");
    } finally {
      setBusy(false);
    }
  }

  function addNonCard() {
    const label = prompt("What is it? (album, photobook, keychain…)");
    if (!label?.trim()) return;
    // Asked straight away rather than left blank, because an unvalued line
    // makes the cards absorb its share of the cost — which is the one thing
    // this screen is trying not to do quietly.
    const entered = prompt(
      `Value of the ${label.trim()}, in dollars, AFTER selling fees.\n` +
      `Leave empty to set it later.`);
    if (entered === null) return;
    const dollars = entered.trim() ? Number(entered) : null;
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      onError("Value must be a number, and not negative.");
      return;
    }
    run(() => addLotLine(lot.listing_id, {
      line_type: "non_card", label: label.trim(), qty: 1,
      value_cents: dollars === null ? null : Math.round(dollars * 100),
    }));
  }

  function addUnidentified() {
    const entered = prompt("How many cards in the lot are not identified yet?", "1");
    if (entered === null) return;
    const qty = Number(entered);
    if (!Number.isInteger(qty) || qty < 1) {
      onError("That needs to be a whole number, at least 1.");
      return;
    }
    run(() => addLotLine(lot.listing_id, { line_type: "unidentified", qty }));
  }

  const th = {
    padding: "4px 6px", textAlign: "right", fontSize: 11, color: "#444",
    borderBottom: "1px solid #ddd", background: "#fafafa", whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 14, opacity: busy ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{lot.title || `listing ${lot.listing_id}`}</strong>
        <span style={{ fontSize: 12, color: "#666" }}>
          {lot.marketplace} · {money(lot.price_cents, lot.currency)}
          {lot.landed_cents != null && <> → <strong>{usd(lot.landed_cents)}</strong> landed</>}
          {/* Postage on a lot is the difference between a good buy and a bad
              one, and it was silently missing from landed cost until the
              listing's own figure was captured. Say which one is in there. */}
          {lot.shipping_usd != null && (
            <span title="postage stated on the listing itself">
              {lot.shipping_usd === 0 ? " (free post)" : ` (incl. ${usd(lot.shipping_usd)} post)`}
            </span>
          )}
          {lot.shipping_usd == null && lot.landed_cents != null && (
            <span style={{ color: "#b45309" }}
                  title="the listing's postage was not read, so the marketplace estimate is standing in">
              {" (est. post)"}
            </span>
          )}
          {" · "}{lot.units} {lot.units === 1 ? "card" : "cards"}
        </span>
        {lot.listing_url && (
          <a href={lot.listing_url} target="_blank" rel="noreferrer"
             style={{ fontSize: 12 }}>open ↗</a>
        )}
        {/* For a lot that should not exist — a duplicate, or a capture read
            off the wrong page. Refreshing a lot's price or shipping needs no
            delete: re-capture it in the extension and the newest sighting
            wins. */}
        <button
          disabled={busy}
          onClick={() => {
            if (!confirm(
              `Delete "${lot.title || `listing ${lot.listing_id}`}" and its price history?\n\n` +
              `This cannot be undone. To pick up a new price or shipping, ` +
              `re-capture the page in the extension instead — no delete needed.`
            )) return;
            run(async () => {
              await deleteMarketListing(lot.listing_id);
              onDeleted();
            });
          }}
          style={{ border: "1px solid #ddd", borderRadius: 3, background: "#fff",
                   padding: "1px 5px", cursor: "pointer", fontSize: 11,
                   color: "#b91c1c" }}
          title="Delete this capture and its price history"
        >
          delete lot
        </button>
      </div>

      {lot.landed_cents == null && (
        <Alert tone="warn" style={{ marginTop: 8 }}>
          No landed cost for this lot — its price has no USD value yet, usually a
          missing exchange rate. Every figure below depends on it.
        </Alert>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12,
                      marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>line</th>
            <th style={th} title="what one of these would net you on a sale">value</th>
            <th style={th} title="this line's share of the lot cost, weighted by value">alloc</th>
            <th style={th} title="value less allocated cost">margin</th>
            <th style={{ ...th, textAlign: "center" }}
                title="keep defaults from the card's library status; click to override">
              keep/flip
            </th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {lot.lines.map((line) => (
            <LotLineRow key={line.line_id} lot={lot} line={line}
                        onChanged={onChanged} onError={onError} />
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8,
                    flexWrap: "wrap" }}>
        <Button size="sm" disabled={busy} onClick={addNonCard}>+ non-card line</Button>
        <Button size="sm" disabled={busy} onClick={addUnidentified}>+ unidentified</Button>
        <span style={{ fontSize: 11, color: "#666", marginLeft: "auto" }}>
          known value <strong>{usd(lot.known_value_cents)}</strong> across{" "}
          {lot.units - lot.unvalued_units} of {lot.units} · landed{" "}
          <strong>{usd(lot.landed_cents)}</strong>
          {lot.unidentified_units > 0 && (
            <span style={{ color: "#b45309" }}>
              {" · "}{lot.unidentified_units} unidentified
            </span>
          )}
        </span>
      </div>

      <Residual lot={lot} />
    </div>
  );
}

// ───────────────────────── Overlays and tabs ────────────────────────────────

// A tab strip. One component for all three levels — page, card, lot — because
// three hand-rolled strips drift apart and the reader has to relearn each one.
function Tabs({ value, onChange, items, style }) {
  return (
    <div style={{ display: "flex", gap: 4, ...style }}>
      {items.map(({ key, label, badge }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "3px 12px", fontSize: 13, cursor: "pointer",
            borderRadius: 4, border: "1px solid #ddd",
            background: value === key ? "#eef6ff" : "#fff",
            fontWeight: value === key ? 600 : 400,
          }}
        >
          {label}
          {badge != null && (
            <span style={{ color: "#999", fontWeight: 400 }}> {badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// The card and lot views open OVER the grid rather than below it, so the grid
// keeps its filters and its sort while you read one row: closing returns you to
// exactly where you were, which a scroll-to-a-panel-underneath never does.
function Overlay({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 40,
        background: "rgba(15,23,42,0.35)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "3vh 2vw",
      }}
    >
      <div
        // The backdrop closes; the panel must not, or every click inside
        // dismisses the thing being read.
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 8, width: "min(1180px, 96vw)",
          maxHeight: "94vh", display: "flex", flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10,
                      padding: "10px 14px", borderBottom: "1px solid #eee" }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          {subtitle && (
            <span style={{ fontSize: 12, color: "#666" }}>{subtitle}</span>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{ marginLeft: "auto", border: "1px solid #ddd", borderRadius: 4,
                     background: "#fff", padding: "2px 9px", cursor: "pointer",
                     fontSize: 13 }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "12px 14px", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// One figure in a summary strip. Null reads as "—" rather than as zero: no data
// and a value of nothing are different claims, and only one of them is a price.
function Stat({ label, value, hint, tone }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600,
                    color: value == null ? "#bbb" : tone || "inherit" }}>
        {value == null ? "—" : value}
      </div>
      {hint && <div style={{ fontSize: 10, color: "#999" }}>{hint}</div>}
    </div>
  );
}

const statRow = {
  display: "flex", gap: 22, flexWrap: "wrap", padding: "8px 10px",
  background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6,
  marginBottom: 10,
};

const th = {
  padding: "4px 6px", textAlign: "right", fontSize: 11, color: "#444",
  borderBottom: "1px solid #ddd", background: "#fafafa", whiteSpace: "nowrap",
};
const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };

// The profit a flip has to clear to be worth doing.
//
// ONE number for every card, everywhere. It reads as per-card in the resell tab
// purely because that tab is inside a card, so the label says otherwise — a
// global setting reached through a card-shaped door is exactly the kind of
// thing that gets changed twice and trusted once. It also has a home in Fees &
// shipping, where module-wide numbers live.
function TargetProfit({ cents, onChanged, onError }) {
  async function edit() {
    const entered = prompt(
      "What does a flip have to clear to be worth doing, in dollars?\n\n" +
      "This is ONE figure for every card, not a setting on this one. It " +
      "decides two things: the price a card with no sold comps would have to " +
      "fetch, and whether an unwanted card earns its place in a lot.",
      (cents / 100).toFixed(2)
    );
    if (entered === null) return;
    const n = Number(entered);
    if (!Number.isFinite(n) || n < 0) return onError("Enter a positive number.");
    try {
      await setMarketSettings({ target_profit_cents: Math.round(n * 100) });
      await onChanged();
    } catch (e) {
      onError(e.message || "Failed to save the target");
    }
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Stat
        label="target profit"
        value={usd(cents)}
        hint="one figure for every card, everywhere"
      />
      <Button size="sm" onClick={edit}>Set target</Button>
    </div>
  );
}

// ───────────────────────── Buy to Keep ──────────────────────────────────────

function BuyToKeep({ detail, onChanged, onOpenLot, onError }) {
  const k = detail.keep;
  const rows = detail.buy_options || [];

  return (
    <div>
      <div style={statRow}>
        <Stat
          label="cheapest single"
          value={usd(k.cheapest_single?.landed_cents)}
          hint={k.cheapest_single ? `${k.cheapest_single.marketplace} · landed` : "none listed"}
        />
        {/* Kept apart from the single on purpose: a per-card figure inside a
            lot is real, and reaching it means buying the whole box. */}
        <Stat
          label="cheapest via lot"
          value={usd(k.cheapest_lot?.landed_per_card_cents)}
          hint={k.cheapest_lot
            ? `${k.cheapest_lot.line_count} cards · ${usd(k.cheapest_lot.landed_cents)} all in`
            : "none listed"}
        />
        {/* Two medians, because they answer the same question about different
            purchases. The gap between them is how much the lots are moving
            this card's market. */}
        <Stat
          label="median ask, singles"
          value={usd(k.median_single_cents)}
          hint={`${k.n_single} listing${k.n_single === 1 ? "" : "s"} you can buy one of`}
        />
        <Stat
          label="median ask, all routes"
          value={usd(k.median_all_per_card_cents)}
          hint={`${k.n_all} routes, lots counted per card`}
        />
        {/* Landed, so it compares with the asks beside it rather than always
            looking cheaper than them. */}
        <Stat
          label="median sold"
          value={usd(k.sold.landed_median_cents)}
          hint={k.sold.n
            ? `${k.sold.n} sold, landed · ${k.sold.n_shipping_known} with real postage`
            : "no sold comps"}
          tone={k.sold.n && k.sold.n < 3 ? "#b45309" : undefined}
        />
      </div>

      {rows.length === 0 && (
        <Alert tone="info">Nothing is listed for this card right now.</Alert>
      )}

      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>listing</th>
              <th style={th} title="cards in the listing, counting quantity">cards</th>
              <th style={th} title="how many of them are on your wanted list">wanted</th>
              <th style={th}>ask</th>
              <th style={th} title="all in: price plus that marketplace's buying costs and postage">landed</th>
              <th style={th} title="landed cost divided by the cards in the listing">per card</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.listing_id}
                // Only a lot has anything more to say; double-clicking a single
                // would open a screen that just repeats this row.
                onDoubleClick={o.line_count > 1 ? () => onOpenLot(o.listing_id) : undefined}
                title={o.line_count > 1 ? "Double-click to judge the whole lot" : undefined}
                style={{ borderTop: "1px solid #f0f0f0",
                         cursor: o.line_count > 1 ? "pointer" : "default" }}
              >
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  <a href={o.listing_url} target="_blank" rel="noreferrer"
                     style={{ color: "inherit" }}>{o.title_raw || `listing ${o.listing_id}`}</a>
                  <span style={{ color: "#999" }}> · {o.marketplace}</span>
                  {!o.fees_configured && (
                    <span style={{ color: "#b45309" }}> · fees not set</span>
                  )}
                  {o.shipping_usd == null && (
                    <span style={{ color: "#b45309" }} title="postage not read from the listing; the marketplace estimate is standing in"> · est. post</span>
                  )}
                </td>
                <td style={td}>{o.line_count}</td>
                <td style={{ ...td, color: o.wanted_count ? "#b45309" : "#bbb" }}>
                  {o.wanted_count || "—"}
                </td>
                <td style={td}>{money(o.price_cents, o.currency)}</td>
                <td style={td}>{usd(o.landed_cents)}</td>
                <td style={td}><strong>{usd(o.landed_per_card_cents)}</strong></td>
                <td style={{ ...td, textAlign: "left" }}>
                  <ListingOutcome listing={o} onDone={onChanged} onError={onError} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ───────────────────────── Buy to Resell ────────────────────────────────────

function BuyToResell({ detail, onChanged, onOpenLot, onError, onTargetChanged }) {
  const r = detail.resell;
  return (
    <div>
      <div style={statRow}>
        <Stat
          label="est. sale, net"
          value={usd(r.net_proceeds_cents)}
          hint={r.n_sold
            ? `median of ${r.n_sold} sold on ${r.sell_marketplace_name || r.sell_marketplace}, after fees`
            : "no sold comps — see below"}
          tone={r.n_sold && r.n_sold < 3 ? "#b45309" : undefined}
        />
        <TargetProfit
          cents={r.target_profit_cents}
          onChanged={onTargetChanged}
          onError={onError}
        />
      </div>

      {r.rows.length === 0 && (
        <Alert tone="info">
          Nothing on {r.source_names?.join(", ") || r.sources.join(", ")} for
          this card right now. This tab compares what a proxy would cost against
          what the card sells for on{" "}
          {r.sell_marketplace_name || r.sell_marketplace}, so it stays empty
          until there is something to buy there.
        </Alert>
      )}

      {r.rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>listing</th>
              <th style={th}>cards</th>
              <th style={th} title="what THIS card costs you — its share of a lot, not the price of the box">your cost</th>
              <th style={th} title="median sold, net of selling fees">est. sale</th>
              <th style={th} title="est. sale less your cost">profit</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {r.rows.map((o) => (
              <tr
                key={o.listing_id}
                onDoubleClick={o.is_lot ? () => onOpenLot(o.listing_id) : undefined}
                title={o.is_lot ? "Double-click to judge the whole lot" : undefined}
                style={{ borderTop: "1px solid #f0f0f0",
                         cursor: o.is_lot ? "pointer" : "default" }}
              >
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  <a href={o.listing_url} target="_blank" rel="noreferrer"
                     style={{ color: "inherit" }}>{o.title_raw || `listing ${o.listing_id}`}</a>
                  <span style={{ color: "#999" }}> · {money(o.price_cents, o.currency)}</span>
                </td>
                <td style={td}>{o.units}</td>
                <td style={td}>
                  {usd(o.buy_cost_cents)}
                  {o.is_lot && (
                    <span style={{ color: "#999" }}
                          title={`this card's share of a ${o.units}-card lot costing ${usd(o.landed_cents)} landed`}> ᴸ</span>
                  )}
                </td>
                <td style={td}>
                  {o.net_proceeds_cents != null ? usd(o.net_proceeds_cents) : (
                    // A requirement, not a measurement: with no comps there is
                    // nothing to estimate, so the question inverts to what it
                    // would HAVE to fetch. Red because it is not evidence.
                    <span style={{ color: "#b91c1c" }}
                          title="No sold comps. This is what it would have to list at to clear the target profit — a requirement, not an estimate.">
                      {usd(o.list_price_cents)}?
                    </span>
                  )}
                </td>
                <td style={td}>
                  {o.profit_cents == null
                    ? <span style={{ color: "#bbb" }}>—</span>
                    : <Margin cents={o.profit_cents} />}
                  {o.meets_target && (
                    <span title="clears the target profit" style={{ color: "#166534" }}> ✓</span>
                  )}
                </td>
                <td style={{ ...td, textAlign: "left" }}>
                  <ListingOutcome listing={o} onDone={onChanged} onError={onError} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ───────────────────────── Is this lot worth buying? ────────────────────────

function LotVerdict({ lot, useful }) {
  const pct = useful.pct_useful;
  // Deliberately no pass/fail threshold. Whether 60% is good depends on the
  // price and on which cards those are, and a green tick over that judgement
  // would be the screen pretending to know something it does not.
  const tone = pct == null ? "#666" : pct >= 60 ? "#166534" : pct >= 35 ? "#b45309" : "#b91c1c";

  return (
    <div>
      <div style={statRow}>
        <Stat
          label="useful cards"
          value={pct == null ? null : `${pct}%`}
          hint={`${useful.useful_units} of ${useful.card_units}`}
          tone={tone}
        />
        <Stat label="landed" value={usd(lot.landed_cents)}
              hint={`${lot.units} cards in the box`} />
        <Stat label="known value" value={usd(lot.known_value_cents)}
              hint={lot.unvalued_units ? `${lot.unvalued_units} unvalued` : "every line valued"} />
        <Stat label="target profit" value={usd(useful.target_profit_cents)}
              hint="what an unwanted card has to clear" />
        {useful.estimated_units > 0 && (
          // The percentage cannot say this and it changes how much weight it
          // carries: a verdict built mostly on era medians is a guess with a
          // number on it.
          <Stat label="judged on estimates" value={`${useful.estimated_units}`}
                hint="priced off their era, not their own comps" tone="#b45309" />
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>card</th>
            <th style={th} title="this card's share of the lot's landed cost">its share</th>
            <th style={th} title="cheapest single-card listing of it anywhere">alone</th>
            <th style={th} title="what it would net on a sale">worth</th>
            <th style={th} title="worth less its share">profit</th>
            <th style={{ ...th, textAlign: "left" }}>verdict</th>
          </tr>
        </thead>
        <tbody>
          {useful.lines.map((ln) => (
            <tr key={ln.line_id}
                style={{ borderTop: "1px solid #f0f0f0",
                         background: ln.useful === true ? "#f0fdf4"
                                   : ln.useful === false ? "#fef2f2" : "transparent" }}>
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                {ln.wanted && <span style={{ color: "#b45309" }}>★ </span>}
                {ln.label}
                {ln.qty > 1 && <span style={{ color: "#999" }}> ×{ln.qty}</span>}
              </td>
              <td style={td}>{usd(ln.alloc_per_unit_cents)}</td>
              <td style={td}>
                {ln.best_single_cents == null
                  ? <span style={{ color: "#bbb" }}>—</span>
                  : usd(ln.best_single_cents)}
              </td>
              <td style={td}>
                {usd(ln.value_cents)}
                {ln.value_source === "era" && (
                  <span style={{ color: "#b45309", fontSize: 10 }} title="no comps of its own; priced off its era"> est.</span>
                )}
              </td>
              <td style={td}>
                {ln.profit_cents == null
                  ? <span style={{ color: "#bbb" }}>—</span>
                  : <Margin cents={ln.profit_cents} />}
              </td>
              <td style={{ ...td, textAlign: "left", whiteSpace: "normal",
                           color: ln.useful === true ? "#166534"
                                : ln.useful === false ? "#b91c1c" : "#999" }}>
                {ln.judged === false ? "not a card" : ln.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketIntelPage() {
  // Two entry points, two questions. Cards answers "what should I act on";
  // Lots answers "is this specific listing worth buying", which is about a
  // whole listing at once and so cannot be asked of a card-shaped view.
  const [view, setView] = useState("cards");
  // Which tab of the card overlay, and which of the lot overlay. Held here
  // rather than inside the overlays so reopening a row lands where you left it.
  // Selecting and OPENING are separate: a click highlights a row, a
  // double-click opens it. Keeping them apart is what lets the grid go on
  // holding a selection while nothing is overlaid.
  const [open, setOpen] = useState(false);
  const [cardTab, setCardTab] = useState("keep");
  const [lotTab, setLotTab] = useState("verdict");
  // A lot opened FROM a card overlay, stacked on top of it. Separate from the
  // Lots tab's own selection: closing this one has to return you to the card
  // you were reading, not to the lot list.
  const [overlayLot, setOverlayLot] = useState(null);
  const [cards, setCards] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [lots, setLots] = useState(null);
  const [lotId, setLotId] = useState(null);
  const [lot, setLot] = useState(null);
  const [fx, setFx] = useState(null);
  // Loaded for the Fees tab, which has no card to read it off. The card overlay
  // gets the same figure back inside its own payload, so the two can never show
  // different numbers for the one setting they share.
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMarketGrid()
      .then((d) => setCards(d.cards || []))
      .catch((e) => setError(e.message || "Failed to load the grid"));
    listFxRates().then(setFx).catch(() => {});
    getMarketSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    getMarketComps(selected)
      .then(setDetail)
      .catch((e) => setError(e.message || "Failed to load card"));
  }, [selected]);

  // Loaded on first visit rather than up front: a lot's analysis walks the
  // whole sold series to build the value ladder, and most visits here are to
  // the grid.
  useEffect(() => {
    if (view !== "lots" || lots !== null) return;
    listMarketLots()
      .then((d) => setLots(d.lots || []))
      .catch((e) => setError(e.message || "Failed to load lots"));
  }, [view, lots]);

  useEffect(() => {
    if (!lotId) return;
    setLot(null);
    getMarketLot(lotId)
      .then((d) => setLot(d.lot))
      .catch((e) => setError(e.message || "Failed to load the lot"));
  }, [lotId]);

  // Editing a line changes the lot AND the row summarising it in the list, so
  // both are refetched — a stale summary above a fresh analysis is the kind of
  // disagreement that gets read as a bug in the arithmetic.
  // Everything the open card overlay reads, and the grid row behind it. Both,
  // because marking a listing sold changes the card's comps AND its row.
  async function refreshCard() {
    if (selected) setDetail(await getMarketComps(selected));
    setCards((await getMarketGrid()).cards || []);
  }

  async function openLotOverlay(listingId) {
    setLotTab("verdict");
    try {
      const d = await getMarketLot(listingId);
      // Flattened: the overlay header wants the lot's own fields and the
      // verdict wants `useful`, and threading two objects through every child
      // buys nothing.
      setOverlayLot({ ...d.lot, lot: d.lot, useful: d.useful });
    } catch (e) {
      setError(e.message || "Failed to load the lot");
    }
  }

  async function refreshLot() {
    const [d, list] = await Promise.all([getMarketLot(lotId), listMarketLots()]);
    setLot(d.lot);
    setLots(list.lots || []);
  }

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
      setCards((await getMarketGrid()).cards || []);
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

      {/* Fees and cost basis were collapsible bars pinned above the grid,
          costing vertical space on every visit to pay for something edited
          once a month. They are tabs now: same content, none of the rent. */}
      <Tabs
        value={view}
        onChange={setView}
        style={{ margin: "12px 0 8px" }}
        items={[
          { key: "cards", label: "Cards" },
          { key: "lots", label: "Lots", badge: lots?.length || null },
          { key: "fees", label: "Fees & shipping" },
          { key: "basis", label: "Cost basis" },
        ]}
      />

      {view === "fees" && (
        <>
          {/* Module-wide, so it belongs beside the other module-wide numbers
              rather than only behind a card overlay. Same setting, same value,
              two doors — a global figure reachable only through one card is
              how it ends up believed to be per-card. */}
          {settings && (
            <div style={{ ...statRow, alignItems: "center" }}>
              <TargetProfit
                cents={settings.target_profit_cents}
                onChanged={async () => {
                  setSettings(await getMarketSettings());
                  if (selected) setDetail(await getMarketComps(selected));
                }}
                onError={setError}
              />
              <span style={{ fontSize: 11, color: "#666", maxWidth: 460 }}>
                Decides the price a card with no sold comps would have to fetch,
                and whether an unwanted card earns its place in a lot. Not a
                setting on any one card.
              </span>
            </div>
          )}
          <FeesPanel
            alwaysOpen
            onError={setError}
            onChanged={async () => {
              setCards((await getMarketGrid()).cards || []);
              if (selected) setDetail(await getMarketComps(selected));
            }}
          />
        </>
      )}
      {view === "basis" && <CostBasisPanel alwaysOpen onError={setError} />}

      {view === "lots" && (
        <>
          {lots === null && <div style={{ color: "#666" }}>Loading…</div>}
          {lots?.length === 0 && (
            <Alert tone="info">
              No lots captured yet. A listing counts as a lot once it holds more
              than one card — associate every card you can identify when you
              capture it, then add the ones you cannot as unidentified lines.
            </Alert>
          )}
          {lots?.length > 0 && (
            <>
              <LotList lots={lots} selected={lotId} onSelect={setLotId} />
              {!lotId && (
                <div style={{ color: "#666", fontSize: 13, marginTop: 10 }}>
                  Pick a lot to split its cost across its cards.
                </div>
              )}
              {lotId && !lot && <div style={{ color: "#666", marginTop: 10 }}>Loading…</div>}
              {lot && (
                <LotAnalyzer
                  lot={lot}
                  onChanged={refreshLot}
                  // A deleted lot has no analysis left to refresh, so the
                  // selection is dropped rather than re-fetched into a 404.
                  onDeleted={async () => {
                    setLotId(null);
                    setLot(null);
                    setLots((await listMarketLots()).lots || []);
                    setCards((await getMarketGrid()).cards || []);
                  }}
                  onError={setError} />
              )}
            </>
          )}
        </>
      )}

      {view === "cards" && cards === null && <div style={{ color: "#666" }}>Loading…</div>}

      {view === "cards" && cards?.length === 0 && (
        <Alert tone="info">
          No comps yet. Capture listings with the extension, associate them to
          cards, then press <strong>Sync</strong>.
        </Alert>
      )}

      {view === "cards" && cards?.length > 0 && (
        <>
          {/* The grid leads, and the per-card comp view below is its
              drill-down. That inversion is what v2 is about: you no longer
              have to already know which card you came to look at. */}
          <MarketGrid
            cards={cards}
            selected={selected}
            onSelect={setSelected}
            onOpen={(id) => { setCardTab("keep"); setSelected(id); setOpen(true); }}
          />
          <div style={{ color: "#666", fontSize: 13, marginTop: 8 }}>
            Double-click a row to open it.
          </div>
        </>
      )}

      {/* The card, over the grid. The grid stays mounted underneath with its
          filters and its sort intact, so closing returns you to exactly where
          you were rather than to a reset list. */}
      {open && selected && (
        <Overlay
          title={cards?.find((c) => c.item_id === selected)?.label || "Card"}
          subtitle={detail ? `${detail.series?.length || 0} sightings` : "loading…"}
          onClose={() => setOpen(false)}
        >
          {!detail && <div style={{ color: "#666" }}>Loading…</div>}
          {detail && (
            <>
              <Tabs
                value={cardTab}
                onChange={setCardTab}
                style={{ marginBottom: 10 }}
                items={[
                  { key: "keep", label: "Buy to keep",
                    badge: detail.buy_options?.length || null },
                  { key: "resell", label: "Buy to resell",
                    badge: detail.resell?.rows?.length || null },
                  { key: "history", label: "Price history" },
                ]}
              />
              {cardTab === "keep" && (
                <BuyToKeep
                  detail={detail}
                  onChanged={refreshCard}
                  onOpenLot={openLotOverlay}
                  onError={setError}
                />
              )}
              {cardTab === "resell" && (
                <BuyToResell
                  detail={detail}
                  onChanged={refreshCard}
                  onOpenLot={openLotOverlay}
                  onError={setError}
                  onTargetChanged={async () => {
                    // Both copies, or the Fees tab keeps showing the old
                    // number until a reload and the one setting looks like two.
                    setSettings(await getMarketSettings());
                    await refreshCard();
                  }}
                />
              )}
              {cardTab === "history" && (
                <CardDetail detail={detail} onChanged={refreshCard} />
              )}
            </>
          )}
        </Overlay>
      )}

      {/* A lot, over the card that led to it. Stacked rather than replacing:
          you got here asking about one card, and closing has to give that
          question back. */}
      {overlayLot && (
        <Overlay
          title={overlayLot.title || `Lot ${overlayLot.listing_id}`}
          subtitle={`${overlayLot.marketplace} · ${overlayLot.units} cards · ${usd(overlayLot.landed_cents)} landed`}
          onClose={() => setOverlayLot(null)}
        >
          <Tabs
            value={lotTab}
            onChange={setLotTab}
            style={{ marginBottom: 10 }}
            items={[
              { key: "verdict", label: "Worth buying?" },
              { key: "split", label: "Cost split" },
            ]}
          />
          {lotTab === "verdict" && overlayLot.useful && (
            <LotVerdict lot={overlayLot.lot} useful={overlayLot.useful} />
          )}
          {lotTab === "split" && (
            <LotAnalyzer
              lot={overlayLot.lot}
              onChanged={async () => {
                const d = await getMarketLot(overlayLot.listing_id);
                setOverlayLot({ ...d.lot, ...d, listing_id: overlayLot.listing_id });
              }}
              onDeleted={async () => {
                setOverlayLot(null);
                await refreshCard();
                setCards((await getMarketGrid()).cards || []);
              }}
              onError={setError}
            />
          )}
        </Overlay>
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
      <td style={{ padding: "3px 6px", textAlign: "right" }}>
        <button
          disabled={busy}
          title={
            c.scope === "per_shipment"
              ? "Lands once per box — divided by the typical box size"
              : "Applies to each listing"
          }
          onClick={async () => {
            setBusy(true);
            try {
              await updateFeeComponent(c.component_id, {
                scope: c.scope === "per_shipment" ? "per_item" : "per_shipment",
              });
              await refresh();
            } catch (e) {
              onError(e.message || "Failed to save");
            } finally {
              setBusy(false);
            }
          }}
          style={{
            border: "1px solid #ddd", borderRadius: 3, cursor: "pointer", fontSize: 10,
            padding: "1px 5px",
            background: c.scope === "per_shipment" ? "#e0e7ff" : "#f3f4f6",
            color: c.scope === "per_shipment" ? "#3730a3" : "#6b7280",
          }}
        >
          {c.scope === "per_shipment" ? "per box" : "per item"}
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
              <td colSpan={5} style={{ padding: "3px 6px", color: "#999", fontSize: 12 }}>
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

function FeesPanel({ alwaysOpen = false, onError, onChanged }) {
  // In a tab there is nothing to collapse INTO -- the header would be a button
  // that hides the only thing on screen.
  const [open, setOpen] = useState(alwaysOpen);
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

  // Asks what a shipment actually CONTAINS, which is sometimes the fee's
  // capacity and sometimes nothing like it. What decides is whether a storage
  // clock forces the box out before it is full:
  //
  //   Pocamarket holds cards indefinitely, so boxes go out full and 40 of a
  //   "$12 up to 40 items" fee is honest -- $0.30 a card, really.
  //
  //   Neokyo's 45-day limit ships whatever has accumulated, so the capacity is
  //   a fiction there: six cards paying a forty-card fee is $2.00 each.
  //
  // An earlier version of this prompt said flatly "not what the fee covers",
  // which is wrong half the time and would have understated Pocamarket by a
  // factor of six. The rule is the contents; the storage terms decide them.
  async function editBoxSize(m) {
    const entered = prompt(
      `${m.marketplace_name} — how many cards a TYPICAL shipment contains.

` +
        "Per-box costs (shipping, handling, wire fees) are divided by this to " +
        "get a per-card share.\n\n" +
        "Answer what actually goes in the box, which is not always what the " +
        "fee covers:\n\n" +
        "  • Storage open-ended, you choose when to ship — boxes go out full, " +
        "so the fee's capacity IS the answer.\n" +
        "  • A storage clock forces it out — answer what accumulates in that " +
        "window. Six cards paying a forty-card fee is $2.00 each, not $0.30." +
        "\n\nLeave blank to clear it.",
      m.buy?.typical_items_per_shipment ?? ""
    );
    if (entered == null) return;
    const t = entered.trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      return onError("Enter a whole number of 1 or more, or leave blank.");
    }
    try {
      await setBoxSize(m.marketplace_code, n);
      await refresh();
    } catch (e) {
      onError(e.message || "Failed to save");
    }
  }

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
        onClick={alwaysOpen ? undefined : () => setOpen((v) => !v)}
        style={{
          display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 10px",
          background: "#fafafa", border: "none", borderRadius: 6, cursor: "pointer",
          textAlign: "left", fontSize: 13,
        }}
      >
        {!alwaysOpen && <span style={{ color: "#666" }}>{open ? "▾" : "▸"}</span>}
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
                <button
                  onClick={() => editBoxSize(m)}
                  title="How many cards a typical shipment CONTAINS. Where storage is open-ended a box goes out full, so the fee's capacity is right; where a storage clock forces it out, answer what accumulates in that window."
                  style={{
                    border: "1px solid #ddd", borderRadius: 3, background: "#fff",
                    padding: "1px 6px", cursor: "pointer", fontSize: 12,
                  }}
                >
                  {m.buy?.typical_items_per_shipment
                    ? `${m.buy.typical_items_per_shipment}/box`
                    : "box size —"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <FeeSide market={m} side="buy" onError={onError} refresh={refresh} />
                <FeeSide market={m} side="sell" onError={onError} refresh={refresh} />
              </div>
              {m.buy?.box_unallocated && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                  Per-box costs are set but no box size is, so they are{" "}
                  <strong>left out entirely</strong> — every purchase here is
                  understated by them. Charging one whole to a single card would
                  be worse than leaving it out, which is why nothing is guessed.
                  {/* A warning that names a control and does not offer it sends
                      the reader hunting along a header row for a small button.
                      Same prompt, at the point the problem is stated. */}
                  <button
                    onClick={() => editBoxSize(m)}
                    style={{
                      marginLeft: 6, border: "1px solid #d97706", borderRadius: 3,
                      background: "#fff", padding: "1px 6px", cursor: "pointer",
                      fontSize: 11, color: "#b45309",
                    }}
                  >
                    Set box size
                  </button>
                </div>
              )}
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
function CostBasisPanel({ alwaysOpen = false, onError }) {
  const [open, setOpen] = useState(alwaysOpen);
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
        onClick={alwaysOpen ? undefined : () => setOpen((v) => !v)}
        style={{
          display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 10px",
          background: "#fafafa", border: "none", borderRadius: 6, cursor: "pointer",
          textAlign: "left", fontSize: 13,
        }}
      >
        {!alwaysOpen && <span style={{ color: "#666" }}>{open ? "▾" : "▸"}</span>}
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
                {" "}— sells {usd(soldMedian)}, you keep {usd(net.net_proceeds_cents)}
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

// "This one is not up any more" — two outcomes, never merged.
//
// Sold WITH a price is a new comp: revisiting a listing you captured is free
// price discovery, and it is the cheapest data this module will ever get.
// Gone is only the absence of an option. A proxy listing that vanishes says
// nothing about what it fetched, so a guessed price would become a comp and
// drag the median down for every disappearance — which is why the server
// refuses a sale with no price rather than assuming the ask.
function ListingOutcome({ listing, onDone, onError }) {
  const [busy, setBusy] = useState(false);

  async function mark(outcome) {
    let price = null;
    if (outcome === "sold") {
      const entered = prompt(
        `What did it sell for, in ${listing.currency}?

` +
          "If you do not know, cancel and use Gone instead — a guessed price " +
          "becomes a comp and drags this card's median."
      );
      if (entered == null) return;
      const n = Number(entered);
      if (!Number.isFinite(n) || n <= 0) return onError("Enter a positive number.");
      const exp = EXPONENT[listing.currency] ?? 2;
      price = Math.round(n * 10 ** exp);
    }
    setBusy(true);
    try {
      await setListingOutcome(listing.listing_id, { outcome, price_cents: price });
      await onDone();
    } catch (e) {
      onError(e.message || "Failed to record it");
    } finally {
      setBusy(false);
    }
  }

  const btn = {
    border: "1px solid #ddd", borderRadius: 3, background: "#fff",
    padding: "1px 5px", cursor: "pointer", fontSize: 11, color: "#555",
  };
  // Deliberately a third, quieter action. `gone` is the ordinary end of a
  // listing and it KEEPS the price history, which is real evidence about what
  // this card was offered at. This throws that away, so it is for captures
  // that should not exist — wrong card, duplicate, bad page read.
  //
  // It is NOT how you refresh one: re-capturing the page in the extension
  // updates the listing and appends a fresh sighting, keeping the history.
  async function remove() {
    const what = listing.title_raw || `listing ${listing.listing_id}`;
    if (!confirm(
      `Delete "${what}" and its price history?\n\n` +
      `This cannot be undone. To just stop it being a buying option, use Gone ` +
      `instead — that keeps the history. To pick up a new price or shipping, ` +
      `re-capture the page in the extension; no delete is needed.`
    )) return;
    setBusy(true);
    try {
      await deleteMarketListing(listing.listing_id);
      await onDone();
    } catch (e) {
      onError(e.message || "Failed to delete it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 4, whiteSpace: "nowrap" }}>
      <button disabled={busy} onClick={() => mark("sold")} style={btn}
              title="It sold — records the price as a comp">sold</button>
      <button disabled={busy} onClick={() => mark("gone")} style={btn}
              title="No longer listed, price unknown — removes it as a buying option, adds no comp">gone</button>
      <button disabled={busy} onClick={remove}
              style={{ ...btn, color: "#b91c1c" }}
              title="Delete this capture and its price history — for a row that should not exist. Not needed to refresh a price: re-capture the page instead.">
        delete
      </button>
    </div>
  );
}

// The evidence behind the figures: the price bands, the basis line, and the raw
// sightings. Buying options moved to the Buy-to-keep tab, and with them the
// only thing on this panel that could fail — hence no error state here.
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
      {/* The evidence, collapsed. It is what makes a statistic auditable --
          a mis-associated listing is only findable by eye -- but it is not
          what anyone comes here to read, and open by default it pushed every
          figure that IS the point below the fold.

          Buying options and excluded lots used to sit under this too. They
          are the Buy-to-keep tab now: one place to read them, not two that
          can disagree. */}
      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#444",
                          padding: "6px 0" }}>
          Listings ({series.length}) — every sighting behind these figures
        </summary>
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
      </details>
    </div>
  );
}
