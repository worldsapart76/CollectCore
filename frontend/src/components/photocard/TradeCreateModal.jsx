import { useEffect, useState } from "react";
import { Modal, Button, Input, Textarea, Checkbox, FormField, Alert } from "../primitives";
import { createTrade } from "../../api";
import { isAdmin } from "../../utils/env";
import { loadTradeDefaults, recordGuestTrade } from "../../utils/tradeDefaults";

/**
 * TradeCreateModal — generates a server-hosted trade page from selected cards.
 *
 * Shared between admin and guest bundles; mode is detected via the build-time
 * isAdmin flag.
 *   - Admin: posts item_ids; trade has no expiry; shown URL has no expiry note.
 *   - Guest: posts catalog_item_ids; trade auto-expires in 30 days; modal
 *     surfaces the expiry; the slug is recorded in guest_meta.my_trades for
 *     the guest's TradesPage to manage.
 */
export default function TradeCreateModal({ selectedCards, onClose, onCreated }) {
  const [defaults, setDefaults] = useState({ from: "", to: "", notes: "" });
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [notes, setNotes] = useState("");
  const [includeBacks, setIncludeBacks] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);  // {slug, url, card_count, expires_at, ...}
  const [copyOk, setCopyOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTradeDefaults()
      .then((d) => {
        if (cancelled) return;
        setDefaults(d);
        setFromName(d.from || "");
        setToName(d.to || "");
        setNotes(d.notes || "");
      })
      .finally(() => { if (!cancelled) setDefaultsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const cardCount = selectedCards.length;

  async function handleSubmit() {
    if (!fromName.trim()) {
      setError("Please enter a 'From' name.");
      return;
    }
    setSubmitting(true);
    setError("");

    const body = {
      created_by: isAdmin ? "admin" : "guest",
      from_name: fromName.trim(),
      to_name: toName.trim() || null,
      notes: notes.trim() || null,
      include_backs: includeBacks,
    };
    if (isAdmin) {
      body.item_ids = selectedCards.map((c) => c.item_id);
    } else {
      body.catalog_item_ids = selectedCards
        .map((c) => c.catalog_item_id)
        .filter(Boolean);
    }

    try {
      const res = await createTrade(body);
      // For guests, persist the slug locally so the guest's TradesPage can
      // show their own trades (no server-side per-user identity).
      if (!isAdmin) {
        await recordGuestTrade({
          slug: res.slug,
          name: body.to_name || "Trade",
          from_name: body.from_name,
          card_count: res.card_count,
          created_at: res.created_at,
          expires_at: res.expires_at,
        }).catch(() => { /* non-fatal — server still has it */ });
      }
      setCreated(res);
      if (onCreated) onCreated(res);
    } catch (e) {
      setError(e.message || "Failed to create trade.");
    } finally {
      setSubmitting(false);
    }
  }

  const tradeUrl = created
    ? `${window.location.origin}/trade/${created.slug}`
    : null;

  async function handleCopy() {
    if (!tradeUrl) return;
    try {
      await navigator.clipboard.writeText(tradeUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1800);
    } catch {
      // Fallback: prompt
      window.prompt("Copy trade URL:", tradeUrl);
    }
  }

  // Compose footer
  const footer = created ? (
    <>
      <Button variant="secondary" onClick={onClose}>Done</Button>
      <Button variant="secondary" onClick={() => window.open(tradeUrl, "_blank")}>Open</Button>
      <Button variant="primary" onClick={handleCopy}>{copyOk ? "Copied!" : "Copy URL"}</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
      <Button variant="primary" onClick={handleSubmit} disabled={submitting || !defaultsLoaded || cardCount === 0}>
        {submitting ? "Generating…" : `Generate (${cardCount})`}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={created ? "Trade page created" : "Generate trade page"}
      size="md"
      footer={footer}
    >
      {created ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <strong>{created.card_count}</strong> card{created.card_count === 1 ? "" : "s"} included.
            {created.skipped_unpublished > 0 && (
              <div style={{ color: "#a86a00", marginTop: 4, fontSize: 13 }}>
                {created.skipped_unpublished} card{created.skipped_unpublished === 1 ? " was" : "s were"} skipped (not yet published to the catalog).
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>Shareable URL</div>
            <Input value={tradeUrl} readOnly onFocus={(e) => e.target.select()} />
          </div>
          {created.expires_at && (
            <div style={{ fontSize: 13, color: "#555" }}>
              Expires {new Date(created.expires_at).toLocaleDateString()}.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            Generating a trade page from <strong>{cardCount}</strong> selected card{cardCount === 1 ? "" : "s"}.
          </div>
          {!isAdmin && (
            <Alert tone="info">
              Guest trade pages auto-expire in 30 days.
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          <FormField label="From">
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Your name"
              disabled={submitting}
            />
          </FormField>

          <FormField label="To">
            <Input
              value={toName}
              onChange={(e) => setToName(e.target.value)}
              placeholder="Recipient (optional)"
              disabled={submitting}
            />
          </FormField>

          <FormField label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional message visible on the trade page"
              disabled={submitting}
            />
          </FormField>

          <Checkbox
            checked={includeBacks}
            onChange={(e) => setIncludeBacks(e.target.checked)}
            disabled={submitting}
            label="Include card backs"
          />

          {(defaults.from || defaults.to || defaults.notes) && (
            <div style={{ fontSize: 12, color: "#777" }}>
              Pre-filled from your defaults — edit on the Trades page.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
