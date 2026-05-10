import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Input, Textarea, FormField, Alert, ConfirmButton } from "../components/primitives";
import { isAdmin } from "../utils/env";
import { listAdminTrades, deleteAdminTrade } from "../api";
import { loadTradeDefaults, saveTradeDefaults, listGuestTrades, removeGuestTrade } from "../utils/tradeDefaults";

// Single page; same component for admin and guest. Branches on isAdmin to
// pick its data source (server vs OPFS) and to decide whether to expose
// the per-trade delete action (admin only — guest trades are server-side
// auto-expiring).
export default function TradesPage() {
  const [trades, setTrades] = useState(null);
  const [error, setError] = useState("");

  // Defaults editor state
  const [defaults, setDefaults] = useState({ from: "", to: "", notes: "" });
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);

  async function reload() {
    try {
      const list = isAdmin ? await listAdminTrades() : await listGuestTrades();
      setTrades(list);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load trades");
    }
  }

  useEffect(() => {
    reload();
    loadTradeDefaults().then(setDefaults).catch(() => {});
  }, []);

  async function handleSaveDefaults() {
    setSavingDefaults(true);
    try {
      await saveTradeDefaults(defaults);
      setDefaultsSaved(true);
      setTimeout(() => setDefaultsSaved(false), 2000);
    } catch (e) {
      setError(e.message || "Failed to save defaults");
    } finally {
      setSavingDefaults(false);
    }
  }

  async function handleDelete(slug) {
    try {
      if (isAdmin) {
        await deleteAdminTrade(slug);
      } else {
        await removeGuestTrade(slug);
      }
      await reload();
    } catch (e) {
      setError(e.message || "Failed to delete trade");
    }
  }

  async function handleCopy(slug) {
    const url = `${window.location.origin}/trade/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy trade URL:", url);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Trades</h1>
        <p style={styles.subtitle}>
          Generate trade pages from the photocard library multi-select.
          {isAdmin
            ? " Admin trades persist until you delete them."
            : " Guest trades auto-expire after 30 days."}
        </p>
      </header>

      {error && <Alert tone="error" style={styles.alert}>{error}</Alert>}

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Default fields</h2>
        <p style={styles.sectionHint}>
          Pre-populate the trade form. Each trade overrides as needed.
        </p>
        <div style={styles.defaultsForm}>
          <FormField label="From">
            <Input
              value={defaults.from}
              onChange={(e) => setDefaults({ ...defaults, from: e.target.value })}
              placeholder="Your name"
            />
          </FormField>
          <FormField label="To">
            <Input
              value={defaults.to}
              onChange={(e) => setDefaults({ ...defaults, to: e.target.value })}
              placeholder='e.g. "Full Trade List"'
            />
          </FormField>
          <FormField label="Notes">
            <Textarea
              value={defaults.notes}
              onChange={(e) => setDefaults({ ...defaults, notes: e.target.value })}
              rows={3}
              placeholder="Default message to include on each trade page"
            />
          </FormField>
          <div style={styles.defaultsActions}>
            <Button variant="primary" onClick={handleSaveDefaults} disabled={savingDefaults}>
              {savingDefaults ? "Saving…" : defaultsSaved ? "Saved!" : "Save defaults"}
            </Button>
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Active trade pages</h2>

        {trades === null ? (
          <div style={styles.empty}>Loading…</div>
        ) : trades.length === 0 ? (
          <div style={styles.empty}>
            No active trade pages. Open the <Link to="/library">Library</Link>, multi-select cards, and click <em>Generate Trade Page</em>.
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>To / Name</th>
                <th style={styles.th}>From</th>
                <th style={styles.th}>Cards</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Expires</th>
                <th style={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.slug}>
                  <td style={styles.td}>
                    <Link to={`/trade/${t.slug}`}>{t.to_name || t.name || "(no name)"}</Link>
                    {t.notes && <div style={styles.notesPreview}>{t.notes}</div>}
                  </td>
                  <td style={styles.td}>{t.from_name}</td>
                  <td style={styles.td}>{t.card_count}</td>
                  <td style={styles.td}>{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</td>
                  <td style={styles.td}>{t.expires_at ? new Date(t.expires_at).toLocaleDateString() : "—"}</td>
                  <td style={styles.tdActions}>
                    <Button size="sm" variant="secondary" onClick={() => handleCopy(t.slug)}>Copy URL</Button>
                    <ConfirmButton
                      label="Delete"
                      size="sm"
                      variant="danger"
                      confirmLabel="Confirm"
                      onConfirm={() => handleDelete(t.slug)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { maxWidth: 1100, margin: "0 auto", padding: "24px 16px 64px" },
  header: { marginBottom: 16 },
  title: { margin: "0 0 6px", fontSize: 22 },
  subtitle: { margin: 0, color: "#6b7280", fontSize: 14 },
  alert: { marginBottom: 16 },
  section: {
    marginBottom: 32,
    padding: 16,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
  },
  sectionTitle: { margin: "0 0 4px", fontSize: 16 },
  sectionHint: { margin: "0 0 16px", color: "#6b7280", fontSize: 13 },
  defaultsForm: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 },
  defaultsActions: { display: "flex", justifyContent: "flex-end", marginTop: 4 },
  empty: { padding: "24px 8px", color: "#6b7280" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontWeight: 500 },
  thActions: { padding: "6px 8px", borderBottom: "1px solid #e5e7eb" },
  td: { padding: "8px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" },
  tdActions: { padding: "8px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 6, justifyContent: "flex-end" },
  notesPreview: { fontSize: 12, color: "#6b7280", marginTop: 2, maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
};
