import { useEffect, useRef, useState } from "react";
import {
  bggGetDetail,
  bggSearchGames,
  createBoardgame,
  fetchBoardgameCategories,
  fetchOwnershipStatuses,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, alertError, alertSuccess, row2 } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { HIDDEN_OWNERSHIP_NAMES } from "../constants/hiddenStatuses";

// ─── Expansions editor ────────────────────────────────────────────────────────

function blankExpansion() {
  return { title: "", year_published: "", ownership_status_id: "" };
}

function ExpansionsEditor({ expansions, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...expansions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...expansions, blankExpansion()]); }
  function remove(idx) { onChange(expansions.filter((_, i) => i !== idx)); }

  return (
    <div>
      {expansions.map((exp, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--surface-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Expansion {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>Title</label>
            <input value={exp.title} onChange={e => update(i, "title", e.target.value)} style={inputStyle} placeholder="Expansion name" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={labelStyle}>Year</label>
              <input value={exp.year_published} onChange={e => update(i, "year_published", e.target.value)} style={inputStyle} placeholder="YYYY" />
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={exp.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Expansion</button>
    </div>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  return {
    title: "",
    categoryId: "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    yearPublished: "",
    minPlayers: "",
    maxPlayers: "",
    designers: [""],
    publisherName: "",
    description: "",
    coverImageUrl: "",
    notes: "",
    expansions: [],
    bggId: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BoardgamesIngestPage() {
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [coverPreview, setCoverPreview] = useState(null);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "boardgames");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  // BGG search state
  const [bggQuery, setBggQuery] = useState("");
  const [bggResults, setBggResults] = useState(null);
  const [bggSearching, setBggSearching] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const [bggError, setBggError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchBoardgameCategories(),
      fetchOwnershipStatuses(),
    ]).then(([cats, own]) => {
      const filteredOwn = own.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
      setCategories(cats);
      setOwnershipStatuses(filteredOwn);
      setForm(blankForm(filteredOwn));
    });
  }, []);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.categoryId) { setError("Player count category is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.categoryId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        notes: form.notes || null,
        description: form.description || null,
        year_published: form.yearPublished ? parseInt(form.yearPublished, 10) : null,
        min_players: form.minPlayers ? parseInt(form.minPlayers, 10) : null,
        max_players: form.maxPlayers ? parseInt(form.maxPlayers, 10) : null,
        publisher_name: form.publisherName.trim() || null,
        designer_names: form.designers.map(d => d.trim()).filter(Boolean),
        cover_image_url: form.coverImageUrl || null,
        api_source: form.bggId ? "bgg" : null,
        external_work_id: form.bggId || null,
        expansions: form.expansions
          .filter(e => e.title.trim())
          .map(e => ({
            title: e.title.trim(),
            year_published: e.year_published ? parseInt(e.year_published, 10) : null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
            external_work_id: e.external_work_id || null,
          })),
      };
      await createBoardgame(payload);
      setSuccess(`"${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses));
      setCoverPreview(null);
      setBggQuery(""); setBggResults(null);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses));
    setError(""); setSuccess(""); setCoverPreview(null);
    setBggQuery(""); setBggResults(null); setBggError("");
  }

  async function handleBggSearch(e) {
    e.preventDefault();
    if (!bggQuery.trim()) return;
    setBggSearching(true); setBggError(""); setBggResults(null);
    try {
      const results = await bggSearchGames(bggQuery.trim());
      setBggResults(results);
    } catch (err) {
      setBggError(err.message || "Search failed.");
    } finally {
      setBggSearching(false);
    }
  }

  async function applyBggResult(result) {
    setBggLoading(true); setBggError("");
    try {
      const detail = await bggGetDetail(result.bgg_id);
      setForm(f => ({
        ...f,
        title: detail.title || f.title,
        yearPublished: detail.year_published ? String(detail.year_published) : f.yearPublished,
        minPlayers: detail.min_players ? String(detail.min_players) : f.minPlayers,
        maxPlayers: detail.max_players ? String(detail.max_players) : f.maxPlayers,
        description: detail.description || f.description,
        coverImageUrl: detail.cover_image_url || f.coverImageUrl,
        designers: detail.designers?.length ? detail.designers : f.designers,
        publisherName: detail.publisher || f.publisherName,
        bggId: result.bgg_id,
        expansions: detail.expansions?.length
          ? detail.expansions.map(ex => ({ title: ex.title, year_published: "", ownership_status_id: "", external_work_id: ex.external_work_id }))
          : f.expansions,
      }));
      setCoverPreview(detail.cover_image_url || null);
      setBggResults(null);
      setBggQuery("");
    } catch (err) {
      setBggError(err.message || "Failed to load BGG details.");
    } finally {
      setBggLoading(false);
    }
  }

  if (!form) return <PageContainer><p style={{ padding: 20, fontSize: 13 }}>Loading…</p></PageContainer>;

  const visibleOwnership = ownershipStatuses;

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "16px 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" }}>Add Board Game</h2>

        {error && <div style={alertError}>{error}</div>}
        {success && <div style={alertSuccess}>{success}</div>}

        {/* BGG Search */}
        <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 6 }}>Search BoardGameGeek</div>
          <form onSubmit={handleBggSearch} style={{ display: "flex", gap: 6, marginBottom: bggResults || bggError ? 8 : 0 }}>
            <input
              value={bggQuery}
              onChange={e => setBggQuery(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Game title…"
            />
            <button type="submit" disabled={bggSearching || !bggQuery.trim()} style={btnSecondary}>
              {bggSearching ? "Searching…" : "Search"}
            </button>
          </form>
          {bggLoading && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Loading details…</div>}
          {bggError && <div style={{ fontSize: 12, color: "var(--error)", marginTop: 4 }}>{bggError}</div>}
          {bggResults && bggResults.length === 0 && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No results found.</div>}
          {bggResults && bggResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {bggResults.map(r => (
                <button
                  key={r.bgg_id}
                  type="button"
                  onClick={() => applyBggResult(r)}
                  style={{ display: "flex", gap: 8, alignItems: "center", background: "none", border: "1px solid var(--border-input)", borderRadius: 3, padding: "4px 8px", cursor: "pointer", textAlign: "left" }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{r.title}</div>
                    {r.year_published && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.year_published}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} placeholder="e.g. Pandemic" autoFocus />
          </div>

          {/* Category + Ownership */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Player Count *</label>
              <select value={form.categoryId} onChange={e => set("categoryId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          {/* Year + Players */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Year Published</label>
              <input value={form.yearPublished} onChange={e => set("yearPublished", e.target.value)} style={inputStyle} placeholder="YYYY" />
            </div>
            <div>
              <label style={labelStyle}>Min Players</label>
              <input value={form.minPlayers} onChange={e => set("minPlayers", e.target.value)} style={inputStyle} placeholder="1" type="number" min="1" />
            </div>
            <div>
              <label style={labelStyle}>Max Players</label>
              <input value={form.maxPlayers} onChange={e => set("maxPlayers", e.target.value)} style={inputStyle} placeholder="4" type="number" min="1" />
            </div>
          </div>

          {/* Designer(s) */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Designer(s)</label>
            <NameList names={form.designers} onChange={v => set("designers", v)} addLabel="+ Designer" placeholder="e.g. Matt Leacock" />
          </div>

          {/* Publisher */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Publisher</label>
            <input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} style={inputStyle} placeholder="e.g. Z-Man Games" />
          </div>

          {/* Cover image */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Cover Image URL</label>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input
                value={form.coverImageUrl}
                onChange={e => { set("coverImageUrl", e.target.value); setCoverPreview(e.target.value || null); }}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="https://…"
              />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
              {coverPreview && (
                <img src={coverPreview} alt="cover preview" style={{ width: 50, height: 70, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => setCoverPreview(null)} />
              )}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 70, resize: "vertical" }} />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 50, resize: "vertical" }} />
          </div>

          {/* Expansions */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Expansions</label>
            <ExpansionsEditor
              expansions={form.expansions}
              ownershipStatuses={visibleOwnership}
              onChange={v => set("expansions", v)}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save Game"}</button>
            <button type="button" onClick={handleReset} style={btnSecondary}>Clear</button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
