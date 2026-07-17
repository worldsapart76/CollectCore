import { useEffect, useState } from "react";
import { bulkCreateState } from "../photocardPageState";
import {
  createPhotocard,
  createPhotocardSourceOrigin,
  fetchOwnershipStatuses,
  fetchPhotocardGroups,
  fetchPhotocardMembers,
  fetchPhotocardSourceOrigins,
  fetchTopLevelCategories,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;

// ─── Styles (mirrors InboxPage) ───────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: "var(--text-sm)", fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const selectStyle = { fontSize: "var(--text-base)", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const inputStyle = { fontSize: "var(--text-base)", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const btnPrimary = { fontSize: "var(--text-base)", padding: "8px 16px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSecondary = { fontSize: "var(--text-base)", padding: "8px 16px", background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSm = { fontSize: "var(--text-xs)", padding: "2px 7px", background: "var(--bg-surface)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--danger-text)", background: "var(--error-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--success-border)", background: "var(--success-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };

// ─── Source origin selector (mirrors InboxPage) ───────────────────────────────

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
            placeholder="New source origin" style={{ ...inputStyle, flex: 1 }} />
          <button type="button" onClick={handleCreate} disabled={creating} style={btnSm}>
            {creating ? "..." : "Save"}
          </button>
        </div>
      )}
      {addError && <div style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", marginTop: 3 }}>{addError}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BulkCreatePage() {
  // Lookup data
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [members, setMembers] = useState([]);
  const [sourceOrigins, setSourceOrigins] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [lookupError, setLookupError] = useState("");

  // Form state — persisted across navigation via module store
  const [groupId, setGroupId] = useState(bulkCreateState.groupId);
  const [categoryId, setCategoryId] = useState(bulkCreateState.categoryId);
  const [ownershipStatusId, setOwnershipStatusId] = useState(bulkCreateState.ownershipStatusId);
  const [selectedMemberIds, setSelectedMemberIds] = useState(bulkCreateState.selectedMemberIds);
  const [sourceOriginId, setSourceOriginId] = useState(bulkCreateState.sourceOriginId);
  const [isSpecial, setIsSpecial] = useState(bulkCreateState.isSpecial);
  const [version, setVersion] = useState(bulkCreateState.version);
  const [notes, setNotes] = useState(bulkCreateState.notes);

  // Action state
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // ── Initial load ──
  useEffect(() => {
    Promise.all([
      fetchPhotocardGroups(),
      fetchTopLevelCategories(COLLECTION_TYPE_ID),
      fetchOwnershipStatuses(COLLECTION_TYPE_ID),
    ])
      .then(([g, c, os]) => {
        setGroups(g);
        setCategories(c);
        setGroupId((prev) =>
          g.some((x) => String(x.group_id) === prev) ? prev : (g.length ? String(g[0].group_id) : "")
        );
        setCategoryId((prev) =>
          c.some((x) => String(x.top_level_category_id) === prev) ? prev : (c.length ? String(c[0].top_level_category_id) : "")
        );
        // Ownership is fixed to Wanted (admin's own annotation, invisible to
        // /pcs/) — no dropdown. Resolve the id by status_code, fall back to first.
        const wanted = os.find((x) => x.status_code === "wanted") || os[0];
        setOwnershipStatusId(wanted ? String(wanted.ownership_status_id) : "");
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
        setSourceOriginId((prev) =>
          data.some((o) => String(o.source_origin_id) === prev)
            ? prev
            : (data.length ? String(data[0].source_origin_id) : "")
        );
      })
      .catch(() => {});
  }, [groupId, categoryId]);

  // ── Sync form state back to module store ──
  useEffect(() => {
    bulkCreateState.groupId           = groupId;
    bulkCreateState.categoryId        = categoryId;
    bulkCreateState.ownershipStatusId = ownershipStatusId;
    bulkCreateState.selectedMemberIds = selectedMemberIds;
    bulkCreateState.sourceOriginId    = sourceOriginId;
    bulkCreateState.isSpecial         = isSpecial;
    bulkCreateState.version           = version;
    bulkCreateState.notes             = notes;
  }, [groupId, categoryId, ownershipStatusId, selectedMemberIds,
      sourceOriginId, isSpecial, version, notes]);

  function toggleMember(id) {
    const sid = String(id);
    setSelectedMemberIds((prev) =>
      prev.includes(sid) ? prev.filter((m) => m !== sid) : [...prev, sid]
    );
    setActionError("");
    setActionSuccess("");
  }

  function basePayload() {
    return {
      collectionTypeId: COLLECTION_TYPE_ID,
      topLevelCategoryId: Number(categoryId),
      ownershipStatusId: Number(ownershipStatusId),
      notes: notes.trim() || null,
      groupId: Number(groupId),
      sourceOriginId: sourceOriginId ? Number(sourceOriginId) : null,
      version: version.trim() || null,
      isSpecial,
    };
  }

  // mode: "separate" (one card per member) | "combined" (one card, all members)
  async function handleCreate(mode) {
    setActionError("");
    setActionSuccess("");
    if (!groupId) { setActionError("Select a group."); return; }
    if (!categoryId) { setActionError("Select a category."); return; }
    if (selectedMemberIds.length === 0) { setActionError("Select at least one member."); return; }

    setSaving(true);
    const base = basePayload();
    try {
      if (mode === "separate") {
        let created = 0;
        // Sequential — SQLite writes; keeps the count accurate on partial failure.
        for (const mid of selectedMemberIds) {
          await createPhotocard({ ...base, memberIds: [Number(mid)] });
          created += 1;
        }
        setActionSuccess(`Created ${created} card${created !== 1 ? "s" : ""} — one per member.`);
      } else {
        await createPhotocard({ ...base, memberIds: selectedMemberIds.map(Number) });
        setActionSuccess(`Created 1 combined card with ${selectedMemberIds.length} member${selectedMemberIds.length !== 1 ? "s" : ""}.`);
      }
    } catch (err) {
      setActionError(err.message || "Create failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingLookups) {
    return <PageContainer><div style={{ padding: 20 }}>Loading...</div></PageContainer>;
  }
  if (lookupError) {
    return <PageContainer><div style={{ padding: 20, color: "var(--error-text)" }}>{lookupError}</div></PageContainer>;
  }

  const memberCount = selectedMemberIds.length;

  return (
    <PageContainer>
      <div style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>Bulk Create Placeholder Cards</h2>
        <p style={{ marginTop: 0, marginBottom: 14, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          Create cards for a set without images. They appear as placeholders until you attach photos later.
        </p>

        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, background: "var(--bg-base)" }}>

          {/* Set selectors */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
            <div>
              <label style={labelStyle}>Version</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)}
                style={inputStyle} placeholder="e.g. Soundwave POB" />
            </div>
            <div>
              <label style={labelStyle}>Card Type</label>
              <div style={{ display: "flex", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", overflow: "hidden", width: "fit-content" }}>
                <button
                  type="button"
                  onClick={() => setIsSpecial(false)}
                  style={{
                    padding: "3px 12px", fontSize: "var(--text-base)", cursor: "pointer",
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
                    padding: "3px 12px", fontSize: "var(--text-base)", cursor: "pointer",
                    border: "none",
                    background: isSpecial ? "var(--btn-primary-bg)" : "var(--bg-surface)",
                    color: isSpecial ? "var(--btn-primary-text)" : "var(--text-primary)",
                  }}
                >
                  ★ Special
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
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
              {members.length === 0 && (
                <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No members for this group.</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={btnSm}
                onClick={() => { setSelectedMemberIds(members.map((m) => String(m.member_id))); setActionError(""); setActionSuccess(""); }}>All</button>
              <button type="button" style={btnSm}
                onClick={() => { setSelectedMemberIds([]); setActionError(""); setActionSuccess(""); }}>None</button>
            </div>
          </div>

          {actionError && <div style={alertError}>{actionError}</div>}
          {actionSuccess && <div style={alertSuccess}>{actionSuccess}</div>}

          <hr style={{ margin: "14px 0", borderColor: "var(--border)" }} />

          {/* Two explicit create buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              onClick={() => handleCreate("separate")}
              disabled={saving || memberCount === 0}
              style={{ ...btnPrimary, opacity: saving || memberCount === 0 ? 0.6 : 1 }}
            >
              {saving ? "Creating..." : `Create separate cards${memberCount ? ` (${memberCount})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => handleCreate("combined")}
              disabled={saving || memberCount === 0}
              style={{ ...btnSecondary, opacity: saving || memberCount === 0 ? 0.6 : 1 }}
            >
              {saving ? "Creating..." : "Create one combined card"}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Separate = one card per checked member. Combined = a single card carrying all checked members.
          </div>
        </div>

        {/* New cards are admin-only drafts until published. Publishing is a
            durable, one-shot admin action (grabs everything not yet in the
            catalog) — not tracked per-session here, so it survives navigation. */}
        <div style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          New cards start as admin-only drafts. When your set is ready, publish
          them so /pcs/ friends can see and track them (no images needed):{" "}
          <strong>Admin → Publish New Cards to Catalog</strong>.
        </div>
      </div>
    </PageContainer>
  );
}
