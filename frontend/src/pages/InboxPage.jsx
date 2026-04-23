import { useEffect, useRef, useState } from "react";
import { inboxState } from "../photocardPageState";
import {
  attachBack,
  createPhotocardSourceOrigin,
  deleteFromInbox,
  fetchInbox,
  fetchIngestCandidates,
  fetchOwnershipStatuses,
  fetchPhotocardGroups,
  fetchPhotocardMembers,
  fetchPhotocardSourceOrigins,
  fetchTopLevelCategories,
  ingestFront,
  ingestPair,
  uploadToInbox,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import { API_BASE } from "../utils/imageUrl";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;

function inboxImageUrl(filename, mtime) {
  return `${API_BASE}/images/inbox/${encodeURIComponent(filename)}?v=${mtime}`;
}

function libraryImageUrl(path) {
  if (!path) return null;
  return `${API_BASE}/${path}?v=${Date.now()}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: "var(--text-sm)", fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const selectStyle = { fontSize: "var(--text-base)", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)" };
const inputStyle = { fontSize: "var(--text-base)", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const btnPrimary = { fontSize: "var(--text-base)", padding: "6px 14px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSecondary = { fontSize: "var(--text-base)", padding: "5px 12px", background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSm = { fontSize: "var(--text-xs)", padding: "2px 7px", background: "var(--bg-surface)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--danger-text)", background: "var(--error-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--success-border)", background: "var(--success-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };

// ─── Upload zone ─────────────────────────────────────────────────────────────

function UploadZone({ onUploaded }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFiles(files) {
    if (!files.length) return;
    setUploading(true);
    setError("");
    const results = [];
    for (const file of files) {
      try {
        results.push(await uploadToInbox(file));
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
    setUploading(false);
    if (results.length) onUploaded(results);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--btn-primary-bg)" : "var(--border-input)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "22px 20px",
        textAlign: "center",
        cursor: "pointer",
        background: dragging ? "var(--green-light)" : "var(--bg-surface)",
        marginBottom: 12,
        fontSize: "var(--text-base)",
        color: "var(--text-muted)",
        minHeight: 70,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uploading ? "Uploading..." : "Drop images here or click to upload to inbox"}
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={(e) => handleFiles(Array.from(e.target.files))} />
      {error && <div style={{ color: "var(--error-text)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ─── Inbox queue ─────────────────────────────────────────────────────────────

function InboxQueue({ files, selectedFilenames, fileSides, onSelect, onToggleSide, onRemove }) {
  if (!files.length) {
    return <div style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "var(--text-base)" }}>Inbox is empty.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {files.map((f) => {
        const side = fileSides[f.filename] ?? "front";
        const selIdx = selectedFilenames.indexOf(f.filename);
        const isSelected = selIdx !== -1;
        return (
          <div
            key={f.filename}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px",
              borderRadius: "var(--radius-md)",
              background: isSelected ? "var(--green-light)" : "transparent",
              border: `1px solid ${isSelected ? "var(--green-vivid)" : "transparent"}`,
            }}
          >
            {/* Side toggle */}
            <button
              type="button"
              title={`Currently: ${side}. Click to switch.`}
              onClick={(e) => { e.stopPropagation(); onToggleSide(f.filename); }}
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                fontSize: 10,
                fontWeight: "bold",
                border: "1px solid var(--border-input)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                background: side === "back" ? "var(--warn-bg)" : "var(--success-bg)",
                color: side === "back" ? "var(--warn-text)" : "var(--success-text)",
                padding: 0,
                lineHeight: 1,
              }}
            >
              {side === "back" ? "B" : "F"}
            </button>

            {/* Thumbnail + name — clicking toggles selection */}
            <div
              onClick={() => onSelect(f.filename)}
              style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer", minWidth: 0 }}
            >
              <img
                src={inboxImageUrl(f.filename, f.mtime)}
                alt={f.filename}
                style={{ width: 34, height: 34, objectFit: "cover", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", flexShrink: 0 }}
              />
              <span style={{ fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                {f.filename}
              </span>
            </div>

            {/* Remove button */}
            <button
              type="button"
              title="Remove from inbox"
              onClick={(e) => { e.stopPropagation(); onRemove(f.filename); }}
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                fontSize: "var(--text-xs)",
                lineHeight: 1,
                padding: 0,
                border: "none",
                borderRadius: 2,
                cursor: "pointer",
                background: "transparent",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--danger-text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Source origin selector ───────────────────────────────────────────────────

function SourceOriginSelector({ sourceOrigins, sourceOriginId, onChange, groupId, categoryId, onCreated }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState("");

  async function handleCreate() {
    setAddError("");
    const trimmed = newName.trim();
    if (!trimmed) { setAddError("Enter a name."); return; }
    try {
      setCreating(true);
      const created = await createPhotocardSourceOrigin({
        groupId: Number(groupId),
        categoryId: Number(categoryId),
        sourceOriginName: trimmed,
      });
      setNewName("");
      setShowAdd(false);
      onCreated(created);
    } catch (err) {
      setAddError(err.message || "Failed to create.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select value={sourceOriginId} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
          <option value="">-- None --</option>
          {sourceOrigins.map((o) => (
            <option key={o.source_origin_id} value={o.source_origin_id}>{o.source_origin_name}</option>
          ))}
        </select>
        <button type="button" onClick={() => setShowAdd((p) => !p)} style={btnSm}>
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>
      {showAdd && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="New source origin" style={{ ...inputStyle, width: "auto", flex: 1 }} />
          <button type="button" onClick={handleCreate} disabled={creating} style={btnSm}>
            {creating ? "..." : "Save"}
          </button>
        </div>
      )}
      {addError && <div style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", marginTop: 3 }}>{addError}</div>}
    </div>
  );
}

// ─── Candidate grid (back attach) ─────────────────────────────────────────────

function CandidateGrid({ candidates, selectedId, onSelect }) {
  if (!candidates.length) {
    return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-base)" }}>No matching cards found.</div>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {candidates.map((card) => (
        <div
          key={card.item_id}
          onClick={() => onSelect(card.item_id)}
          style={{
            width: 80,
            cursor: "pointer",
            border: `2px solid ${selectedId === card.item_id ? "var(--btn-primary-bg)" : "var(--border-input)"}`,
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            background: selectedId === card.item_id ? "var(--green-light)" : "var(--bg-base)",
          }}
        >
          {card.front_image_path ? (
            <img
              src={libraryImageUrl(card.front_image_path)}
              alt={`#${card.item_id}`}
              style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
            />
          ) : (
            <div style={{ width: "100%", height: 70, background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-muted)" }}>
              No image
            </div>
          )}
          <div style={{ padding: "2px 4px", fontSize: 10, lineHeight: 1.3 }}>
            <div style={{ fontWeight: "bold" }}>#{card.item_id}</div>
            <div style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {card.members.join(", ") || "—"}
            </div>
            {card.version && (
              <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.version}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  // Inbox state
  const [inboxFiles, setInboxFiles] = useState([]);
  const [selectedFilenames, setSelectedFilenames] = useState([]); // ordered, max 2
  const [fileSides, setFileSides] = useState({}); // {filename: 'front'|'back'}

  // Lookup data
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [lookupError, setLookupError] = useState("");

  // Persistent metadata form — initialized from module store, survives tab navigation
  const [groupId, setGroupId] = useState(inboxState.groupId);
  const [categoryId, setCategoryId] = useState(inboxState.categoryId);
  const [ownershipStatusId, setOwnershipStatusId] = useState(inboxState.ownershipStatusId);
  const [members, setMembers] = useState([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState(inboxState.selectedMemberIds);
  const [sourceOrigins, setSourceOrigins] = useState([]);
  const [sourceOriginId, setSourceOriginId] = useState(inboxState.sourceOriginId);
  const [isSpecial, setIsSpecial] = useState(inboxState.isSpecial);
  const [version, setVersion] = useState(inboxState.version);
  const [notes, setNotes] = useState(inboxState.notes);

  // Candidate state (back mode)
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState("");

  // Action state
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Preview thumbnail size
  const [previewLarge, setPreviewLarge] = useState(true);

  // ── Initial load ──
  useEffect(() => {
    Promise.all([
      fetchPhotocardGroups(),
      fetchTopLevelCategories(COLLECTION_TYPE_ID),
      fetchOwnershipStatuses(COLLECTION_TYPE_ID),
      fetchInbox(),
    ])
      .then(([g, c, os, inbox]) => {
        setGroups(g);
        setCategories(c);
        const HIDDEN = new Set(["Formerly Owned", "Borrowed"]);
        setOwnershipStatuses(os.filter(s => !HIDDEN.has(s.status_name)));
        setInboxFiles(inbox);
        // Preserve stored value if still valid; otherwise default to first item
        setGroupId((prev) =>
          g.some((x) => String(x.group_id) === prev) ? prev : (g.length ? String(g[0].group_id) : "")
        );
        setCategoryId((prev) =>
          c.some((x) => String(x.top_level_category_id) === prev) ? prev : (c.length ? String(c[0].top_level_category_id) : "")
        );
        setOwnershipStatusId((prev) =>
          os.some((x) => String(x.ownership_status_id) === prev) ? prev : (os.length ? String(os[0].ownership_status_id) : "")
        );
        if (inbox.length) setSelectedFilenames([inbox[0].filename]);
      })
      .catch((err) => setLookupError(err.message || "Failed to load data"))
      .finally(() => setLoadingLookups(false));
  }, []);

  // ── Members: reload when group changes ──
  useEffect(() => {
    if (!groupId) { setMembers([]); return; }
    fetchPhotocardMembers(groupId)
      .then((data) => setMembers(data))
      .catch(() => {});
  }, [groupId]);

  // ── Source origins: reload when group+category change ──
  useEffect(() => {
    if (!groupId || !categoryId) { setSourceOrigins([]); setSourceOriginId(""); return; }
    fetchPhotocardSourceOrigins(groupId, categoryId)
      .then((data) => {
        setSourceOrigins(data);
        // Preserve current value if still valid for this group+category; else default to first
        setSourceOriginId((prev) =>
          data.some((o) => String(o.source_origin_id) === prev)
            ? prev
            : (data.length ? String(data[0].source_origin_id) : "")
        );
      })
      .catch(() => {});
  }, [groupId, categoryId]);

  // ── Sync form state back to module store for cross-tab persistence ──
  useEffect(() => {
    inboxState.groupId           = groupId;
    inboxState.categoryId        = categoryId;
    inboxState.ownershipStatusId = ownershipStatusId;
    inboxState.selectedMemberIds = selectedMemberIds;
    inboxState.sourceOriginId    = sourceOriginId;
    inboxState.isSpecial         = isSpecial;
    inboxState.version           = version;
    inboxState.notes             = notes;
  }, [groupId, categoryId, ownershipStatusId, selectedMemberIds,
      sourceOriginId, isSpecial, version, notes]);

  // ── Derive selected file objects from filenames ──
  const selectedFiles = selectedFilenames
    .map((name) => inboxFiles.find((f) => f.filename === name))
    .filter(Boolean);

  // Determine panel mode from selection
  let panelMode = "none"; // none | front | back | pair | invalid-pair
  if (selectedFiles.length === 1) {
    panelMode = (fileSides[selectedFiles[0].filename] ?? "front") === "back" ? "back" : "front";
  } else if (selectedFiles.length === 2) {
    const sides = selectedFiles.map((f) => fileSides[f.filename] ?? "front");
    if (sides[0] !== sides[1]) {
      panelMode = "pair";
    } else {
      panelMode = "invalid-pair";
    }
  }

  // Convenience for single-file panels
  const singleFile = selectedFiles.length === 1 ? selectedFiles[0] : null;
  const pairFront = panelMode === "pair"
    ? selectedFiles.find((f) => (fileSides[f.filename] ?? "front") === "front")
    : null;
  const pairBack = panelMode === "pair"
    ? selectedFiles.find((f) => (fileSides[f.filename] ?? "front") === "back")
    : null;

  // ── Candidates: auto-load when single back file is selected ──
  useEffect(() => {
    if (panelMode !== "back" || !groupId || !categoryId) {
      setCandidates([]);
      setSelectedCandidateId(null);
      return;
    }
    setLoadingCandidates(true);
    setCandidateError("");
    setSelectedCandidateId(null);
    fetchIngestCandidates(groupId, categoryId, true, selectedMemberIds.map(Number))
      .then((data) => {
        setCandidates(data);
        if (!data.length) setCandidateError("No matching cards without backs found.");
      })
      .catch((err) => setCandidateError(err.message || "Failed to load candidates."))
      .finally(() => setLoadingCandidates(false));
  }, [singleFile?.filename, panelMode, groupId, categoryId, selectedMemberIds.join(",")]);

  // ── Helpers ──
  async function refreshInbox() {
    const data = await fetchInbox().catch(() => []);
    setInboxFiles(data);
    return data;
  }

  function toggleMember(id) {
    const sid = String(id);
    setSelectedMemberIds((prev) =>
      prev.includes(sid) ? prev.filter((m) => m !== sid) : [...prev, sid]
    );
  }

  function toggleFileSide(filename) {
    setFileSides((prev) => ({
      ...prev,
      [filename]: (prev[filename] ?? "front") === "front" ? "back" : "front",
    }));
    setActionError("");
    setActionSuccess("");
  }

  // Toggle a filename in/out of selection (max 2; adding a 3rd bumps the oldest)
  function toggleFileSelection(filename) {
    setSelectedFilenames((prev) => {
      if (prev.includes(filename)) return prev.filter((n) => n !== filename);
      if (prev.length < 2) return [...prev, filename];
      return [prev[1], filename]; // drop oldest, add new
    });
    setActionError("");
    setActionSuccess("");
  }

  function removeFromInbox(filenames) {
    const names = Array.isArray(filenames) ? filenames : [filenames];
    setInboxFiles((prev) => {
      const next = prev.filter((f) => !names.includes(f.filename));
      // auto-select next available file not already selected
      setSelectedFilenames((prevSel) => {
        const remaining = next.filter((f) => !prevSel.includes(f.filename));
        const kept = prevSel.filter((n) => !names.includes(n));
        if (kept.length === 0 && remaining.length > 0) return [remaining[0].filename];
        return kept;
      });
      return next;
    });
    setFileSides((prev) => {
      const copy = { ...prev };
      names.forEach((n) => delete copy[n]);
      return copy;
    });
  }

  async function handleRemoveFromInbox(filename) {
    try {
      await deleteFromInbox(filename);
    } catch {
      // silently ignore — remove from UI regardless
    }
    removeFromInbox(filename);
  }

  // ── Front ingest ──
  async function handleIngestFront() {
    setActionError("");
    setActionSuccess("");
    if (!singleFile) { setActionError("Select a file first."); return; }
    if (!groupId) { setActionError("Select a group."); return; }
    if (!categoryId) { setActionError("Select a category."); return; }
    if (selectedMemberIds.length === 0) { setActionError("Select at least one member."); return; }

    setSaving(true);
    try {
      const result = await ingestFront({
        inboxFilename: singleFile.filename,
        collectionTypeId: COLLECTION_TYPE_ID,
        topLevelCategoryId: Number(categoryId),
        ownershipStatusId: Number(ownershipStatusId),
        notes: notes.trim() || null,
        groupId: Number(groupId),
        sourceOriginId: sourceOriginId ? Number(sourceOriginId) : null,
        version: version.trim() || null,
        memberIds: selectedMemberIds.map(Number),
        isSpecial,
      });
      setActionSuccess(`Created item #${result.item_id} — ${result.filename}`);
      removeFromInbox(singleFile.filename);
    } catch (err) {
      setActionError(err.message || "Ingest failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Back attach ──
  async function handleAttachBack() {
    setActionError("");
    setActionSuccess("");
    if (!singleFile) { setActionError("Select a file first."); return; }
    if (!selectedCandidateId) { setActionError("Select a candidate card."); return; }

    setSaving(true);
    try {
      const result = await attachBack(singleFile.filename, selectedCandidateId);
      setActionSuccess(`Attached back to item #${result.item_id} — ${result.filename}`);
      removeFromInbox(singleFile.filename);
    } catch (err) {
      setActionError(err.message || "Attach failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Pair ingest ──
  async function handleIngestPair() {
    setActionError("");
    setActionSuccess("");
    if (!pairFront || !pairBack) { setActionError("Need one front and one back file."); return; }
    if (!groupId) { setActionError("Select a group."); return; }
    if (!categoryId) { setActionError("Select a category."); return; }
    if (selectedMemberIds.length === 0) { setActionError("Select at least one member."); return; }

    setSaving(true);
    try {
      const result = await ingestPair({
        frontFilename: pairFront.filename,
        backFilename: pairBack.filename,
        collectionTypeId: COLLECTION_TYPE_ID,
        topLevelCategoryId: Number(categoryId),
        ownershipStatusId: Number(ownershipStatusId),
        notes: notes.trim() || null,
        groupId: Number(groupId),
        sourceOriginId: sourceOriginId ? Number(sourceOriginId) : null,
        version: version.trim() || null,
        memberIds: selectedMemberIds.map(Number),
        isSpecial,
      });
      setActionSuccess(`Created item #${result.item_id} with front + back`);
      removeFromInbox([pairFront.filename, pairBack.filename]);
    } catch (err) {
      setActionError(err.message || "Pair ingest failed.");
    } finally {
      setSaving(false);
    }
  }

  // ── Upload handler ──
  function handleUploaded(results) {
    refreshInbox().then((files) => {
      if (results.length > 0) {
        const newFile = files.find((f) => f.filename === results[0].filename);
        if (newFile) setSelectedFilenames([newFile.filename]);
      } else if (files.length > 0 && selectedFilenames.length === 0) {
        setSelectedFilenames([files[0].filename]);
      }
    });
  }

  if (loadingLookups) {
    return <PageContainer><div style={{ padding: 20 }}>Loading...</div></PageContainer>;
  }
  if (lookupError) {
    return <PageContainer><div style={{ padding: 20, color: "var(--error-text)" }}>{lookupError}</div></PageContainer>;
  }

  return (
    <PageContainer>
      <div style={{ padding: 16, width: "fit-content", margin: "0 auto" }}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>Inbox</h2>

        <UploadZone onUploaded={handleUploaded} />

        <div style={{ display: "grid", gridTemplateColumns: "220px auto", gap: 16, alignItems: "start" }}>

          {/* Left: inbox queue */}
          <div>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "bold", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Inbox ({inboxFiles.length})
            </div>
            <InboxQueue
              files={inboxFiles}
              selectedFilenames={selectedFilenames}
              fileSides={fileSides}
              onSelect={toggleFileSelection}
              onToggleSide={toggleFileSide}
              onRemove={handleRemoveFromInbox}
            />
          </div>

          {/* Right: metadata form + action */}
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, background: "var(--bg-base)" }}>

            {/* ── Top section: 3-column layout ── */}
            <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 16, marginBottom: 14, alignItems: "start" }}>

              {/* Col 1: Thumbnail */}
              <div style={{ flexShrink: 0 }}>
                {(panelMode === "front" || panelMode === "back") && singleFile && (
                  <div style={{ position: "relative" }}>
                    <img
                      src={inboxImageUrl(singleFile.filename, singleFile.mtime)}
                      alt={singleFile.filename}
                      style={{
                        maxHeight: previewLarge ? 220 : 80,
                        maxWidth: previewLarge ? 180 : 70,
                        objectFit: "contain",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-input)",
                        display: "block",
                      }}
                    />
                    <button
                      type="button"
                      title={previewLarge ? "Shrink preview" : "Enlarge preview"}
                      onClick={() => setPreviewLarge((p) => !p)}
                      style={{
                        position: "absolute", bottom: 3, right: 3,
                        fontSize: 9, padding: "1px 4px", lineHeight: 1.4,
                        border: "1px solid var(--border-input)", borderRadius: 2, cursor: "pointer",
                        background: "rgba(255,255,255,0.85)", color: "var(--text-secondary)",
                      }}
                    >
                      {previewLarge ? "−" : "+"}
                    </button>
                  </div>
                )}
                {(panelMode === "pair" || panelMode === "invalid-pair") && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {selectedFiles.map((f) => {
                      const side = fileSides[f.filename] ?? "front";
                      return (
                        <div key={f.filename} style={{ textAlign: "center" }}>
                          <img
                            src={inboxImageUrl(f.filename, f.mtime)}
                            alt={f.filename}
                            style={{ maxHeight: 80, maxWidth: 70, objectFit: "contain", borderRadius: "var(--radius-md)", border: "1px solid var(--border-input)", display: "block" }}
                          />
                          <div style={{ fontSize: 10, fontWeight: "bold", marginTop: 2, color: side === "front" ? "var(--success-text)" : "var(--warn-text)" }}>
                            {side.toUpperCase()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Col 2: filename, badge, Card Type, Ownership */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {panelMode === "none" && (
                  <div style={{ color: "var(--text-muted)", fontSize: "var(--text-base)" }}>Select a file from the inbox queue.</div>
                )}
                {(panelMode === "front" || panelMode === "back") && singleFile && (
                  <>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{singleFile.filename}</div>
                    <div style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "bold",
                      background: panelMode === "back" ? "var(--warn-bg)" : "var(--success-bg)",
                      color: panelMode === "back" ? "var(--warn-text)" : "var(--success-text)",
                      border: `1px solid ${panelMode === "back" ? "var(--warn-border)" : "var(--success-border)"}`,
                      width: "fit-content",
                    }}>
                      {panelMode === "back" ? "Back" : "Front"}
                    </div>
                  </>
                )}
                {panelMode === "pair" && (
                  <div style={{
                    display: "inline-block", padding: "3px 10px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: "bold",
                    background: "var(--green-light)", color: "var(--green)", border: "1px solid var(--green-vivid)", width: "fit-content",
                  }}>
                    Pair
                  </div>
                )}
                {panelMode === "invalid-pair" && (
                  <div style={{ ...alertError, marginBottom: 0 }}>
                    Both selected files are marked as the same side. Toggle one to F and one to B to ingest as a pair.
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Card Type</label>
                  <div style={{ display: "flex", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", width: "fit-content" }}>
                    <button
                      type="button"
                      onClick={() => setIsSpecial(false)}
                      style={{
                        padding: "3px 10px", fontSize: "var(--text-sm)", cursor: "pointer",
                        border: "none", borderRight: "1px solid var(--border-input)",
                        background: !isSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                        color: !isSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
                      }}
                    >
                      Regular
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSpecial(true)}
                      style={{
                        padding: "3px 10px", fontSize: "var(--text-sm)", cursor: "pointer",
                        border: "none",
                        background: isSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                        color: isSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
                      }}
                    >
                      ★ Special
                    </button>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Ownership</label>
                  <select value={ownershipStatusId} onChange={(e) => setOwnershipStatusId(e.target.value)} style={selectStyle}>
                    {ownershipStatuses.map((s) => (
                      <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Col 3: Group, Category, Source Origin */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={labelStyle}>Group</label>
                  <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={selectStyle}>
                    {groups.map((g) => (
                      <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={selectStyle}>
                    {categories.map((c) => (
                      <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Source Origin</label>
                  <SourceOriginSelector
                    sourceOrigins={sourceOrigins}
                    sourceOriginId={sourceOriginId}
                    onChange={setSourceOriginId}
                    groupId={groupId}
                    categoryId={categoryId}
                    onCreated={(created) => {
                      setSourceOrigins((prev) => [...prev, created]);
                      setSourceOriginId(String(created.source_origin_id));
                    }}
                  />
                </div>
              </div>
            </div>

            {actionError && <div style={alertError}>{actionError}</div>}
            {actionSuccess && <div style={alertSuccess}>{actionSuccess}</div>}

            {/* ── Bottom section ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Version</label>
                <input value={version} onChange={(e) => setVersion(e.target.value)}
                  style={inputStyle} placeholder="e.g. Soundwave POB" />
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {/* Members */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Members</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {members.map((m) => (
                  <label
                    key={m.member_id}
                    style={{
                      display: "flex", alignItems: "center", padding: "2px 6px",
                      border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "var(--text-sm)",
                      background: selectedMemberIds.includes(String(m.member_id)) ? "var(--green-light)" : "var(--bg-surface)",
                    }}
                  >
                    <input type="checkbox"
                      checked={selectedMemberIds.includes(String(m.member_id))}
                      onChange={() => toggleMember(m.member_id)}
                      style={{ marginRight: 4 }}
                    />
                    {m.member_name}
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={btnSm}
                  onClick={() => setSelectedMemberIds(members.map((m) => String(m.member_id)))}>All</button>
                <button type="button" style={btnSm}
                  onClick={() => setSelectedMemberIds([])}>None</button>
              </div>
            </div>

            <hr style={{ margin: "14px 0", borderColor: "var(--border)" }} />

            {/* ── Action area ── */}
            {panelMode === "front" && (
              <button type="button" onClick={handleIngestFront} disabled={saving} style={btnPrimary}>
                {saving ? "Ingesting..." : "Ingest as Front"}
              </button>
            )}

            {panelMode === "back" && (
              <div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 8 }}>
                  Attach back to:
                  {loadingCandidates && <span style={{ color: "var(--text-muted)", fontWeight: "normal", marginLeft: 6 }}>Loading...</span>}
                  {!loadingCandidates && candidates.length > 0 && (
                    <span style={{ color: "var(--text-muted)", fontWeight: "normal", marginLeft: 6 }}>
                      {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {candidateError && <div style={{ color: "var(--error-text)", fontSize: "var(--text-base)", marginBottom: 8 }}>{candidateError}</div>}
                <CandidateGrid candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} />
                {candidates.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAttachBack}
                    disabled={saving || !selectedCandidateId}
                    style={{ ...btnPrimary, marginTop: 12, opacity: !selectedCandidateId ? 0.6 : 1 }}
                  >
                    {saving ? "Attaching..." : `Attach Back${selectedCandidateId ? ` → #${selectedCandidateId}` : ""}`}
                  </button>
                )}
              </div>
            )}

            {panelMode === "pair" && (
              <button type="button" onClick={handleIngestPair} disabled={saving} style={btnPrimary}>
                {saving ? "Ingesting..." : "Ingest as Front + Back"}
              </button>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
