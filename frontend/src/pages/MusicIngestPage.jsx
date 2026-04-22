import { useEffect, useRef, useState } from "react";
import {
  createMusicRelease,
  discogsFetchMaster,
  discogsSearchMusic,
  fetchMusicFormatTypes,
  fetchMusicGenres,
  fetchMusicReleaseTypes,
  fetchOwnershipStatuses,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, alertError, alertSuccess, row2, sectionStyle, sectionLabel } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";


// ─── Genre picker ─────────────────────────────────────────────────────────────

function GenrePicker({ allGenres, selected, onChange }) {
  const [topSel, setTopSel] = useState("");
  const [subSel, setSubSel] = useState("");

  const topGenre = allGenres.find(g => String(g.top_genre_id) === topSel);
  const subGenres = topGenre?.sub_genres || [];

  function add() {
    if (!topSel) return;
    const topId = parseInt(topSel, 10);
    const subId = subSel ? parseInt(subSel, 10) : null;
    const key = `${topId}-${subId}`;
    if (selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === key)) return;
    onChange([...selected, { top_genre_id: topId, sub_genre_id: subId }]);
    setTopSel(""); setSubSel("");
  }

  function remove(idx) { onChange(selected.filter((_, i) => i !== idx)); }

  function labelFor(g) {
    const top = allGenres.find(t => t.top_genre_id === g.top_genre_id);
    if (!top) return String(g.top_genre_id);
    if (!g.sub_genre_id) return top.genre_name;
    const sub = top.sub_genres.find(s => s.sub_genre_id === g.sub_genre_id);
    return sub ? `${top.genre_name} — ${sub.sub_genre_name}` : top.genre_name;
  }

  function handleTopChange(val) {
    setTopSel(val);
    setSubSel("");
    const found = allGenres.find(g => String(g.top_genre_id) === val);
    if (found && found.sub_genres.length === 0) {
      const topId = parseInt(val, 10);
      if (!selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === `${topId}-null`)) {
        onChange([...selected, { top_genre_id: topId, sub_genre_id: null }]);
      }
      setTopSel("");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <select value={topSel} onChange={e => handleTopChange(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 140 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </select>
        {subGenres.length > 0 && (
          <>
            <select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 140 }}>
              <option value="">Subgenre…</option>
              {subGenres.map(s => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
            </select>
            <button type="button" onClick={add} style={btnSm}>Add</button>
          </>
        )}
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {selected.map((g, i) => (
            <span key={i} style={{ fontSize: 11, padding: "2px 6px", background: "var(--green-light)", border: "1px solid var(--border-input)", borderRadius: 10, display: "flex", alignItems: "center", gap: 4, color: "var(--green)" }}>
              {labelFor(g)}
              <button type="button" onClick={() => remove(i)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#555", padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Track list editor ────────────────────────────────────────────────────────

function blankSong() { return { title: "", duration_seconds: "", track_number: "", disc_number: 1 }; }

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseDuration(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

function TrackListEditor({ songs, onChange }) {
  function update(idx, key, val) {
    const next = [...songs];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...songs, { ...blankSong(), track_number: songs.length + 1 }]); }
  function remove(idx) { onChange(songs.filter((_, i) => i !== idx)); }

  return (
    <div>
      {songs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 60px 40px 24px", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", textAlign: "center" }}>#</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Title</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Duration</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Disc</span>
          <span />
        </div>
      )}
      {songs.map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 60px 40px 24px", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <input
            value={s.track_number}
            onChange={e => update(i, "track_number", e.target.value)}
            style={{ ...inputStyle, textAlign: "center", padding: "2px 3px" }}
            placeholder="#"
          />
          <input
            value={s.title}
            onChange={e => update(i, "title", e.target.value)}
            style={inputStyle}
            placeholder="Track title"
          />
          <input
            value={s.duration_seconds ? formatDuration(s.duration_seconds) : (s._durStr || "")}
            onChange={e => {
              const next = [...songs];
              const parsed = parseDuration(e.target.value);
              next[i] = { ...next[i], duration_seconds: parsed, _durStr: e.target.value };
              onChange(next);
            }}
            style={{ ...inputStyle, padding: "2px 4px" }}
            placeholder="m:ss"
          />
          <input
            value={s.disc_number}
            onChange={e => update(i, "disc_number", parseInt(e.target.value, 10) || 1)}
            style={{ ...inputStyle, textAlign: "center", padding: "2px 3px" }}
          />
          <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828", padding: "2px 5px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, marginTop: 2 }}>+ Track</button>
    </div>
  );
}

// ─── Editions editor ──────────────────────────────────────────────────────────

function blankEdition() {
  return { format_type_id: "", version_name: "", label: "", catalog_number: "", barcode: "", notes: "", ownership_status_id: "" };
}

function EditionsEditor({ editions, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...editions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...editions, blankEdition()]); }
  function remove(idx) { onChange(editions.filter((_, i) => i !== idx)); }

  return (
    <div>
      {editions.map((e, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Edition {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={e.format_type_id} onChange={ev => update(i, "format_type_id", ev.target.value)} style={selectStyle}>
                <option value="">None</option>
                {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Version Name</label>
              <input value={e.version_name} onChange={ev => update(i, "version_name", ev.target.value)} style={inputStyle} placeholder="e.g. Limited Edition" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input value={e.label} onChange={ev => update(i, "label", ev.target.value)} style={inputStyle} placeholder="Record label" />
            </div>
            <div>
              <label style={labelStyle}>Catalog #</label>
              <input value={e.catalog_number} onChange={ev => update(i, "catalog_number", ev.target.value)} style={inputStyle} placeholder="e.g. SKZ-9988" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Barcode</label>
              <input value={e.barcode} onChange={ev => update(i, "barcode", ev.target.value)} style={inputStyle} placeholder="UPC / EAN" />
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={e.ownership_status_id} onChange={ev => update(i, "ownership_status_id", ev.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={e.notes} onChange={ev => update(i, "notes", ev.target.value)} style={inputStyle} placeholder="Edition notes" />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Edition</button>
    </div>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses, releaseTypes) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  const album = releaseTypes.find(r => r.category_name === "Album");
  return {
    title: "",
    releaseTypeId: album ? String(album.top_level_category_id) : "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    releaseDate: "",
    description: "",
    coverImageUrl: "",
    notes: "",
    artists: [""],
    genres: [],
    songs: [],
    editions: [],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MusicIngestPage() {
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
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
      const { url } = await uploadCover(file, "music");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  // Discogs search
  const [discogsQuery, setDiscogsQuery] = useState("");
  const [discogsResults, setDiscogsResults] = useState([]);
  const [discogsSearching, setDiscogsSearching] = useState(false);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [discogsError, setDiscogsError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.music),
      fetchMusicReleaseTypes(),
      fetchMusicFormatTypes(),
      fetchMusicGenres(),
    ]).then(([own, types, fmts, genres]) => {
      setOwnershipStatuses(own);
      setReleaseTypes(types);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setForm(blankForm(own, types));
    }).catch(err => {
      setError(err.message || "Failed to load page data. Has the music migration been run?");
      setForm({});
    });
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleDiscogsSearch() {
    if (!discogsQuery.trim()) return;
    setDiscogsSearching(true);
    setDiscogsError("");
    setDiscogsResults([]);
    try {
      const results = await discogsSearchMusic(discogsQuery);
      setDiscogsResults(results);
      if (results.length === 0) setDiscogsError("No results found.");
    } catch (err) {
      setDiscogsError(err.message || "Search failed.");
    } finally {
      setDiscogsSearching(false);
    }
  }

  async function handleDiscogsSelect(result) {
    setDiscogsLoading(true);
    setDiscogsError("");
    try {
      const detail = await discogsFetchMaster(result.discogs_id);
      const newCover = detail.cover_image_url || null;
      setForm(f => ({
        ...f,
        title: detail.title || f.title,
        releaseDate: detail.year ? String(detail.year) : f.releaseDate,
        coverImageUrl: newCover || f.coverImageUrl,
        artists: detail.artists.length > 0 ? detail.artists : f.artists,
        songs: detail.tracklist.map((t, i) => ({
          title: t.title,
          duration_seconds: t.duration_seconds,
          _durStr: t.duration_seconds ? formatDuration(t.duration_seconds) : "",
          track_number: t.track_number || (i + 1),
          disc_number: t.disc_number || 1,
        })),
      }));
      setCoverPreview(newCover);
      setDiscogsResults([]);
      setDiscogsQuery("");
    } catch (err) {
      setDiscogsError(err.message || "Failed to load release details.");
    } finally {
      setDiscogsLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.releaseTypeId) { setError("Release type is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.releaseTypeId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        release_date: form.releaseDate || null,
        description: form.description || null,
        cover_image_url: form.coverImageUrl || null,
        notes: form.notes || null,
        artist_names: form.artists.map(a => a.trim()).filter(Boolean),
        genres: form.genres,
        songs: form.songs
          .filter(s => s.title.trim())
          .map(s => ({
            title: s.title.trim(),
            duration_seconds: s.duration_seconds || null,
            track_number: s.track_number ? parseInt(s.track_number, 10) : null,
            disc_number: s.disc_number || 1,
          })),
        editions: form.editions
          .filter(e => e.format_type_id || e.version_name)
          .map(e => ({
            format_type_id: e.format_type_id ? parseInt(e.format_type_id, 10) : null,
            version_name: e.version_name || null,
            label: e.label || null,
            catalog_number: e.catalog_number || null,
            barcode: e.barcode || null,
            notes: e.notes || null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
          })),
      };
      await createMusicRelease(payload);
      const typeLabel = releaseTypes.find(r => String(r.top_level_category_id) === form.releaseTypeId)?.category_name || "Release";
      setSuccess(`${typeLabel} "${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses, releaseTypes));
      setCoverPreview(null);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses, releaseTypes));
    setError(""); setSuccess(""); setCoverPreview(null);
  }

  if (!form) return <PageContainer><p style={{ padding: 20, fontSize: 13 }}>Loading…</p></PageContainer>;
  if (error && !form.title && form.title !== "") return <PageContainer><div style={{ ...alertError, margin: 20 }}>{error}</div></PageContainer>;



  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "16px 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" }}>Add Music Release</h2>

        {error && <div style={alertError}>{error}</div>}
        {success && <div style={alertSuccess}>{success}</div>}

        {/* Discogs Search */}
        <div style={{ ...sectionStyle, marginBottom: 16 }}>
          <div style={sectionLabel}>Search Discogs</div>
          <div style={{ display: "flex", gap: 6, marginBottom: discogsResults.length > 0 || discogsError ? 6 : 0 }}>
            <input
              value={discogsQuery}
              onChange={e => setDiscogsQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleDiscogsSearch()}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Artist, title, or both…"
            />
            <button type="button" onClick={handleDiscogsSearch} disabled={discogsSearching || discogsLoading} style={btnPrimary}>
              {discogsSearching ? "Searching…" : "Search"}
            </button>
          </div>
          {discogsLoading && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Loading release…</div>}
          {discogsError && <div style={{ fontSize: 12, color: "var(--error-border)" }}>{discogsError}</div>}
          {discogsResults.length > 0 && (
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 3 }}>
              {discogsResults.map(r => (
                <div
                  key={r.discogs_id}
                  onClick={() => handleDiscogsSelect(r)}
                  style={{ display: "flex", gap: 8, padding: "6px 8px", borderBottom: "1px solid var(--border)", cursor: "pointer", alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  {r.thumb_url
                    ? <img src={r.thumb_url} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />
                    : <div style={{ width: 38, height: 38, background: "var(--surface-2)", borderRadius: 2, flexShrink: 0 }} />
                  }
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {r.artists?.join(", ")}{r.year ? ` · ${r.year}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} placeholder="e.g. MIROH" autoFocus />
          </div>

          {/* Release type / Ownership */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Release Type *</label>
              <select value={form.releaseTypeId} onChange={e => set("releaseTypeId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {releaseTypes.map(r => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
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

          {/* Release date */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Release Date</label>
            <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} placeholder="YYYY-MM-DD" />
          </div>

          {/* Artists */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Artist(s)</label>
            <NameList names={form.artists} onChange={v => set("artists", v)} addLabel="+ Artist" placeholder="Artist name" />
          </div>

          {/* Genre */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Genre</label>
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
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
                <img src={coverPreview} alt="cover preview" style={{ width: 50, height: 50, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => setCoverPreview(null)} />
              )}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 60, resize: "vertical" }} />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 50, resize: "vertical" }} />
          </div>

          {/* Track list */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>Track List</div>
            <TrackListEditor songs={form.songs} onChange={v => set("songs", v)} />
          </div>

          {/* Editions */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>Editions / Versions</div>
            <EditionsEditor
              editions={form.editions}
              formatTypes={formatTypes}
              ownershipStatuses={ownershipStatuses}
              onChange={v => set("editions", v)}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save Release"}</button>
            <button type="button" onClick={handleReset} style={btnSecondary}>Clear</button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
