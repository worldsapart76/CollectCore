import { useEffect, useRef, useState } from "react";
import {
  createTtrpg,
  fetchOwnershipStatuses,
  fetchTtrpgBookTypes,
  fetchTtrpgFormatTypes,
  fetchTtrpgSystems,
  fetchTtrpgSystemEditions,
  fetchTtrpgLines,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: 12, fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const inputStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const selectStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%" };
const btnPrimary = { fontSize: 13, padding: "6px 14px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: 4, cursor: "pointer" };
const btnSecondary = { fontSize: 13, padding: "5px 12px", background: "var(--btn-secondary-bg)", color: "var(--btn-secondary-text)", border: "1px solid var(--btn-secondary-border)", borderRadius: 4, cursor: "pointer" };
const btnSm = { fontSize: 11, padding: "2px 7px", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", borderRadius: 3, cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--error-border)", background: "var(--error-bg)", fontSize: 13, borderRadius: 3 };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid #2e7d32", background: "var(--green-light)", fontSize: 13, borderRadius: 3 };
const row2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };

const HIDDEN_OWNERSHIP_NAMES = new Set(["Trade", "Formerly Owned", "Pending", "Borrowed"]);

// ─── NameList (authors) ───────────────────────────────────────────────────────

function NameList({ names, onChange, addLabel, placeholder }) {
  function update(idx, val) { const next = [...names]; next[idx] = val; onChange(next); }
  function add() { onChange([...names, ""]); }
  function remove(idx) { onChange(names.filter((_, i) => i !== idx)); }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input value={n} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
          {names.length > 1 && <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕</button>}
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, alignSelf: "flex-start" }}>{addLabel}</button>
    </div>
  );
}

// ─── Copies editor ────────────────────────────────────────────────────────────

function blankCopy() {
  return { format_type_id: "", isbn_13: "", isbn_10: "", ownership_status_id: "", notes: "" };
}

function CopiesEditor({ copies, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...copies];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...copies, blankCopy()]); }
  function remove(idx) { onChange(copies.filter((_, i) => i !== idx)); }

  return (
    <div>
      {copies.map((copy, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--surface-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Copy {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={row2}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={copy.format_type_id} onChange={e => update(i, "format_type_id", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={copy.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
          <div style={row2}>
            <div>
              <label style={labelStyle}>ISBN-13</label>
              <input value={copy.isbn_13} onChange={e => update(i, "isbn_13", e.target.value)} style={inputStyle} placeholder="978-…" />
            </div>
            <div>
              <label style={labelStyle}>ISBN-10</label>
              <input value={copy.isbn_10} onChange={e => update(i, "isbn_10", e.target.value)} style={inputStyle} placeholder="0-…" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={copy.notes} onChange={e => update(i, "notes", e.target.value)} style={inputStyle} placeholder="e.g. Signed copy" />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Copy</button>
    </div>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  return {
    title: "",
    systemId: "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    systemEditionName: "",
    lineName: "",
    bookTypeId: "",
    publisherName: "",
    authors: [""],
    releaseDate: "",
    coverImageUrl: "",
    description: "",
    notes: "",
    copies: [],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TTRPGIngestPage() {
  const [systems, setSystems] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [bookTypes, setBookTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [systemEditions, setSystemEditions] = useState([]);
  const [lines, setLines] = useState([]);
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
      const { url } = await uploadCover(file, "ttrpg");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    Promise.all([
      fetchTtrpgSystems(),
      fetchOwnershipStatuses(),
      fetchTtrpgBookTypes(),
      fetchTtrpgFormatTypes(),
    ]).then(([sys, own, bt, ft]) => {
      const filteredOwn = own.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
      setSystems(sys);
      setOwnershipStatuses(filteredOwn);
      setBookTypes(bt);
      setFormatTypes(ft);
      setForm(blankForm(filteredOwn));
    });
  }, []);

  // Load editions + lines when system changes
  useEffect(() => {
    if (!form?.systemId) { setSystemEditions([]); setLines([]); return; }
    const id = parseInt(form.systemId, 10);
    Promise.all([
      fetchTtrpgSystemEditions(id),
      fetchTtrpgLines(id),
    ]).then(([editions, lns]) => {
      setSystemEditions(editions);
      setLines(lns);
    });
  }, [form?.systemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.systemId) { setError("Game system is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.systemId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        notes: form.notes || null,
        description: form.description || null,
        system_edition_name: form.systemEditionName.trim() || null,
        line_name: form.lineName.trim() || null,
        book_type_id: form.bookTypeId ? parseInt(form.bookTypeId, 10) : null,
        publisher_name: form.publisherName.trim() || null,
        author_names: form.authors.map(a => a.trim()).filter(Boolean),
        release_date: form.releaseDate || null,
        cover_image_url: form.coverImageUrl || null,
        copies: form.copies
          .filter(c => c.format_type_id || c.isbn_13 || c.isbn_10)
          .map(c => ({
            format_type_id: c.format_type_id ? parseInt(c.format_type_id, 10) : null,
            isbn_13: c.isbn_13 || null,
            isbn_10: c.isbn_10 || null,
            ownership_status_id: c.ownership_status_id ? parseInt(c.ownership_status_id, 10) : null,
            notes: c.notes || null,
          })),
      };
      await createTtrpg(payload);
      setSuccess(`"${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses));
      setCoverPreview(null);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses));
    setError(""); setSuccess(""); setCoverPreview(null);
  }

  if (!form) return <PageContainer><p style={{ padding: 20, fontSize: 13 }}>Loading…</p></PageContainer>;

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "16px 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" }}>Add TTRPG Book</h2>

        {error && <div style={alertError}>{error}</div>}
        {success && <div style={alertSuccess}>{success}</div>}

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} placeholder="e.g. Player's Handbook" autoFocus />
          </div>

          {/* System + Ownership */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Game System *</label>
              <select value={form.systemId} onChange={e => { set("systemId", e.target.value); set("systemEditionName", ""); set("lineName", ""); }} style={selectStyle}>
                <option value="">Select…</option>
                {systems.map(s => <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          {/* System Edition + Line */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>System Edition</label>
              <input
                value={form.systemEditionName}
                onChange={e => set("systemEditionName", e.target.value)}
                style={inputStyle}
                placeholder={form.systemId ? "e.g. 5e, 2e, 1st ed." : "Select a system first"}
                disabled={!form.systemId}
                list="edition-list"
              />
              <datalist id="edition-list">
                {systemEditions.map(ed => <option key={ed.edition_id} value={ed.edition_name} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Line / Setting</label>
              <input
                value={form.lineName}
                onChange={e => set("lineName", e.target.value)}
                style={inputStyle}
                placeholder={form.systemId ? "e.g. Forgotten Realms" : "Select a system first"}
                disabled={!form.systemId}
                list="line-list"
              />
              <datalist id="line-list">
                {lines.map(ln => <option key={ln.line_id} value={ln.line_name} />)}
              </datalist>
            </div>
          </div>

          {/* Book Type + Release Date */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Book Type</label>
              <select value={form.bookTypeId} onChange={e => set("bookTypeId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {bookTypes.map(bt => <option key={bt.book_type_id} value={bt.book_type_id}>{bt.book_type_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Release Date</label>
              <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={inputStyle} placeholder="YYYY or YYYY-MM-DD" />
            </div>
          </div>

          {/* Publisher */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Publisher</label>
            <input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} style={inputStyle} placeholder="e.g. Wizards of the Coast" />
          </div>

          {/* Authors */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Author(s)</label>
            <NameList names={form.authors} onChange={v => set("authors", v)} addLabel="+ Author" placeholder="e.g. Gary Gygax" />
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

          {/* Copies */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Copies / Formats</label>
            <CopiesEditor
              copies={form.copies}
              formatTypes={formatTypes}
              ownershipStatuses={ownershipStatuses}
              onChange={v => set("copies", v)}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save Book"}</button>
            <button type="button" onClick={handleReset} style={btnSecondary}>Clear</button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
