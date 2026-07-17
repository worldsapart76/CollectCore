import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPhotocardGroups,
  fetchPhotocardSourceOrigins,
  fetchTopLevelCategories,
  listPhotocards,
  replaceBackImage,
  replaceFrontImage,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import { API_BASE } from "../utils/imageUrl";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.photocards;
const PAGE_SIZE = 24;

function libraryImageUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}/${path}?v=${Date.now()}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: "var(--text-sm)", fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const selectStyle = { fontSize: "var(--text-base)", padding: "3px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)" };
const btnPrimary = { fontSize: "var(--text-base)", padding: "8px 16px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSecondary = { fontSize: "var(--text-base)", padding: "5px 12px", background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-md)", cursor: "pointer" };
const btnSm = { fontSize: "var(--text-xs)", padding: "2px 8px", background: "var(--bg-surface)", border: "1px solid var(--border-input)", borderRadius: "var(--radius-sm)", cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--danger-text)", background: "var(--error-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--success-border)", background: "var(--success-bg)", fontSize: "var(--text-base)", borderRadius: "var(--radius-sm)" };

const SLOT_W = 92;
const SLOT_H = 132;

// ─── Image slot (front/back drop target) ──────────────────────────────────────

function Slot({ side, existingPath, staged, onDropPool, onPick, onClear, dragRef }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const showStaged = !!staged;
  const showExisting = !showStaged && !!existingPath;

  return (
    <div style={{ textAlign: "center" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          // An in-progress internal drag wins — dragging a pool <img> can also
          // populate dataTransfer.files, which would otherwise look like an OS
          // drop and wrongly copy the image instead of moving it out of the pool.
          if (dragRef?.current != null) { onDropPool(); return; }
          if (e.dataTransfer.files && e.dataTransfer.files.length) {
            onPick(e.dataTransfer.files[0]);
            return;
          }
          onDropPool();
        }}
        onClick={() => { if (!showStaged) inputRef.current?.click(); }}
        title={showStaged ? "Staged — click ✕ to undo" : "Drop an image or click to pick"}
        style={{
          position: "relative",
          width: SLOT_W,
          height: SLOT_H,
          borderRadius: "var(--radius-md)",
          border: `2px ${showStaged ? "solid var(--green-vivid)" : (over ? "dashed var(--btn-primary-bg)" : (showExisting ? "solid var(--border-input)" : "dashed var(--border-input)"))}`,
          background: over ? "var(--green-light)" : "var(--bg-surface)",
          overflow: "hidden",
          cursor: showStaged ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showStaged ? (
          <>
            <img src={staged.url} alt="staged" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <button
              type="button"
              title="Undo — remove this image"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              style={{
                position: "absolute", top: 2, right: 2, width: 20, height: 20,
                border: "none", borderRadius: "50%", cursor: "pointer",
                background: "var(--danger-text)", color: "#fff", fontSize: 12, lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ✕
            </button>
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "var(--green-vivid)", color: "#fff", fontSize: 9,
              padding: "1px 0", textAlign: "center", letterSpacing: "0.05em",
            }}>
              STAGED
            </div>
          </>
        ) : showExisting ? (
          <>
            <img src={libraryImageUrl(existingPath)} alt={side} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 9,
              padding: "1px 0", textAlign: "center",
            }}>
              replace {side}
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 10, textAlign: "center", padding: 4 }}>
            drop {side}
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BatchImagePage() {
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sourceOrigins, setSourceOrigins] = useState([]);
  const [allCards, setAllCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Scope
  const [groupId, setGroupId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sourceOriginId, setSourceOriginId] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [showFilter, setShowFilter] = useState("all"); // all | front | back | any
  const [page, setPage] = useState(0);

  // Pool + staged assignments
  const [pool, setPool] = useState([]); // {pid, file, url, name}
  const [assignments, setAssignments] = useState({}); // itemId -> { front?, back? }  (each {pid,file,url,name,fromPool})
  const pidRef = useRef(1);
  const draggingRef = useRef(null);
  const [poolOver, setPoolOver] = useState(false);

  // Commit
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [commitErr, setCommitErr] = useState("");

  // ── Load ──
  async function loadCards() {
    const cards = await listPhotocards();
    setAllCards(cards);
    return cards;
  }

  useEffect(() => {
    Promise.all([fetchPhotocardGroups(), fetchTopLevelCategories(COLLECTION_TYPE_ID), listPhotocards()])
      .then(([g, c, cards]) => {
        setGroups(g);
        setCategories(c);
        setAllCards(cards);
        setGroupId(g.length ? String(g[0].group_id) : "");
        setCategoryId(c.length ? String(c[0].top_level_category_id) : "");
      })
      .catch((err) => setLoadError(err.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!groupId || !categoryId) { setSourceOrigins([]); setSourceOriginId(""); return; }
    fetchPhotocardSourceOrigins(groupId, categoryId)
      .then((data) => {
        setSourceOrigins(data);
        setSourceOriginId((prev) => (data.some((o) => String(o.source_origin_id) === prev) ? prev : ""));
      })
      .catch(() => {});
  }, [groupId, categoryId]);

  // Revoke all object URLs on unmount. Uses a live ref so cleanup sees the
  // latest pool/assignments, not the empty first-render closure.
  const liveRef = useRef({ pool: [], assignments: {} });
  liveRef.current = { pool, assignments };
  useEffect(() => () => {
    const { pool: p, assignments: a } = liveRef.current;
    p.forEach((x) => URL.revokeObjectURL(x.url));
    Object.values(a).forEach((s) => {
      if (s.front) URL.revokeObjectURL(s.front.url);
      if (s.back) URL.revokeObjectURL(s.back.url);
    });
  }, []);

  // ── Scope filtering ──
  const scopedBeforeVersion = useMemo(() => allCards.filter((c) =>
    String(c.group_id) === groupId &&
    String(c.top_level_category_id) === categoryId &&
    (!sourceOriginId || String(c.source_origin_id) === sourceOriginId)
  ), [allCards, groupId, categoryId, sourceOriginId]);

  const versionOptions = useMemo(() => {
    const set = new Set();
    scopedBeforeVersion.forEach((c) => { if (c.version) set.add(c.version); });
    return Array.from(set).sort();
  }, [scopedBeforeVersion]);

  const scoped = useMemo(() => scopedBeforeVersion.filter((c) => {
    if (versionFilter && c.version !== versionFilter) return false;
    if (showFilter === "front" && c.front_image_path) return false;
    if (showFilter === "back" && c.back_image_path) return false;
    if (showFilter === "any" && c.front_image_path && c.back_image_path) return false;
    return true;
  }), [scopedBeforeVersion, versionFilter, showFilter]);

  useEffect(() => { setPage(0); }, [groupId, categoryId, sourceOriginId, versionFilter, showFilter]);

  const pageCount = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageCards = scoped.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const stagedCount = useMemo(() => Object.values(assignments)
    .reduce((n, a) => n + (a.front ? 1 : 0) + (a.back ? 1 : 0), 0), [assignments]);

  // ── Pool ──
  function addFiles(files) {
    const items = Array.from(files).map((file) => ({
      pid: pidRef.current++,
      file,
      url: URL.createObjectURL(file),
      name: file.name,
    }));
    if (items.length) setPool((prev) => [...prev, ...items]);
  }

  function removeFromPool(pid) {
    setPool((prev) => {
      const it = prev.find((p) => p.pid === pid);
      if (it) URL.revokeObjectURL(it.url);
      return prev.filter((p) => p.pid !== pid);
    });
  }

  // ── Assign / unassign ──
  // Images move between the pool and card slots; they are only destroyed for
  // good via the pool ✕, on successful commit, or on unmount. Assigning/undoing
  // never revokes a URL — so dragging out and back always works.
  function putInSlot(itemId, side, item) {
    const displaced = assignments[itemId]?.[side] || null;
    setAssignments((prev) => {
      const next = { ...prev };
      const cur = { ...(next[itemId] || {}) };
      cur[side] = item;
      next[itemId] = cur;
      return next;
    });
    setCommitMsg("");
    return displaced;
  }

  function assignFromPool(itemId, side) {
    const pid = draggingRef.current;
    draggingRef.current = null;
    if (pid == null) return;
    const item = pool.find((p) => p.pid === pid);
    if (!item) return;
    const displaced = putInSlot(itemId, side, item);
    // Remove the assigned image from the pool; if a card slot was occupied,
    // that displaced image returns to the pool.
    setPool((prev) => {
      const filtered = prev.filter((p) => p.pid !== pid);
      return displaced ? [...filtered, displaced] : filtered;
    });
  }

  function pickForSlot(itemId, side, file) {
    const item = { pid: pidRef.current++, file, url: URL.createObjectURL(file), name: file.name };
    const displaced = putInSlot(itemId, side, item);
    if (displaced) setPool((prev) => [...prev, displaced]);
  }

  function clearSlot(itemId, side) {
    const item = assignments[itemId]?.[side];
    setAssignments((prev) => {
      const next = { ...prev };
      const cur = { ...(next[itemId] || {}) };
      delete cur[side];
      if (!cur.front && !cur.back) delete next[itemId];
      else next[itemId] = cur;
      return next;
    });
    if (item) setPool((prev) => [...prev, item]); // back to the pool, not destroyed
  }

  function discardAll() {
    // Move every staged image back to the pool and clear the cards — nothing is
    // destroyed. Use the pool ✕ to remove an image for good.
    const returned = [];
    Object.values(assignments).forEach((a) => {
      if (a.front) returned.push(a.front);
      if (a.back) returned.push(a.back);
    });
    if (returned.length) setPool((prev) => [...prev, ...returned]);
    setAssignments({});
    setCommitMsg("");
    setCommitErr("");
  }

  // ── Commit ──
  async function handleCommit() {
    setCommitErr("");
    setCommitMsg("");
    const jobs = [];
    for (const [itemId, a] of Object.entries(assignments)) {
      if (a.front) jobs.push({ itemId: Number(itemId), side: "front", staged: a.front });
      if (a.back) jobs.push({ itemId: Number(itemId), side: "back", staged: a.back });
    }
    if (!jobs.length) return;

    setCommitting(true);
    let done = 0;
    const failures = [];
    for (const job of jobs) {
      try {
        if (job.side === "front") await replaceFrontImage(job.itemId, job.staged.file);
        else await replaceBackImage(job.itemId, job.staged.file);
        URL.revokeObjectURL(job.staged.url);
        done += 1;
      } catch (err) {
        failures.push(`#${job.itemId} ${job.side}: ${err.message || "failed"}`);
      }
    }
    setCommitting(false);
    setAssignments({});
    await loadCards().catch(() => {});
    if (failures.length) {
      setCommitErr(`${done} saved, ${failures.length} failed — ${failures.join("; ")}`);
    } else {
      setCommitMsg(`Saved ${done} image${done !== 1 ? "s" : ""}. Publish them to R2 from Admin when ready.`);
    }
  }

  if (loading) return <PageContainer><div style={{ padding: 20 }}>Loading...</div></PageContainer>;
  if (loadError) return <PageContainer><div style={{ padding: 20, color: "var(--error-text)" }}>{loadError}</div></PageContainer>;

  return (
    <PageContainer>
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>Batch Images</h2>
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          Drop photos into the pool, drag them onto cards (or click a slot to pick). Nothing is saved until you click Save — use ✕ to undo any drop.
        </p>

        {/* Scope bar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Group</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={selectStyle}>
              {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={selectStyle}>
              {categories.map((c) => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Source Origin</label>
            <select value={sourceOriginId} onChange={(e) => setSourceOriginId(e.target.value)} style={selectStyle}>
              <option value="">-- All --</option>
              {sourceOrigins.map((o) => <option key={o.source_origin_id} value={o.source_origin_id}>{o.source_origin_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Version</label>
            <select value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)} style={selectStyle}>
              <option value="">-- All --</option>
              {versionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Show</label>
            <select value={showFilter} onChange={(e) => setShowFilter(e.target.value)} style={selectStyle}>
              <option value="all">All cards</option>
              <option value="front">Missing front</option>
              <option value="back">Missing back</option>
              <option value="any">Missing front or back</option>
            </select>
          </div>
          <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {scoped.length} card{scoped.length !== 1 ? "s" : ""}
          </div>
        </div>

        {commitErr && <div style={alertError}>{commitErr}</div>}
        {commitMsg && <div style={alertSuccess}>{commitMsg}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "start" }}>

          {/* Left: pool + commit */}
          <div style={{ position: "sticky", top: 12 }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "bold", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              To-do pool ({pool.length})
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setPoolOver(true); }}
              onDragLeave={() => setPoolOver(false)}
              onDrop={(e) => { e.preventDefault(); setPoolOver(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
              style={{
                border: `2px dashed ${poolOver ? "var(--btn-primary-bg)" : "var(--border-input)"}`,
                borderRadius: "var(--radius-md)", padding: 8, minHeight: 90,
                background: poolOver ? "var(--green-light)" : "var(--bg-surface)",
                display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start",
              }}
            >
              {pool.length === 0 && (
                <label style={{ margin: "auto", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)", cursor: "pointer" }}>
                  Drop images here<br />or click to add
                  <input type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                </label>
              )}
              {pool.map((p) => (
                <div
                  key={p.pid}
                  draggable
                  onDragStart={() => { draggingRef.current = p.pid; }}
                  onDragEnd={() => { draggingRef.current = null; }}
                  title={p.name}
                  style={{ position: "relative", width: 48, height: 68, borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-input)", cursor: "grab", background: "var(--bg-base)" }}
                >
                  <img src={p.url} alt={p.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <button
                    type="button"
                    title="Remove from pool"
                    onClick={() => removeFromPool(p.pid)}
                    style={{ position: "absolute", top: 1, right: 1, width: 16, height: 16, border: "none", borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, lineHeight: 1, cursor: "pointer", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {pool.length > 0 && (
              <label style={{ ...btnSm, display: "inline-block", marginTop: 6, cursor: "pointer" }}>
                + Add more
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            )}

            <hr style={{ margin: "12px 0", borderColor: "var(--border)" }} />
            <div style={{ fontSize: "var(--text-sm)", marginBottom: 8 }}>
              <strong>{stagedCount}</strong> image{stagedCount !== 1 ? "s" : ""} staged
            </div>
            <button type="button" onClick={handleCommit} disabled={committing || stagedCount === 0}
              style={{ ...btnPrimary, width: "100%", opacity: committing || stagedCount === 0 ? 0.6 : 1 }}>
              {committing ? "Saving..." : `Save ${stagedCount || ""}`.trim()}
            </button>
            {stagedCount > 0 && !committing && (
              <button type="button" onClick={discardAll} style={{ ...btnSecondary, width: "100%", marginTop: 6 }}>
                Discard all
              </button>
            )}
          </div>

          {/* Right: card grid */}
          <div>
            {pageCards.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", padding: 20 }}>
                No cards match this scope.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {pageCards.map((card) => {
                  const a = assignments[card.item_id] || {};
                  return (
                    <div key={card.item_id} style={{ width: SLOT_W * 2 + 8, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 8, background: "var(--bg-base)" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <Slot side="front" existingPath={card.front_image_path} staged={a.front} dragRef={draggingRef}
                          onDropPool={() => assignFromPool(card.item_id, "front")}
                          onPick={(f) => pickForSlot(card.item_id, "front", f)}
                          onClear={() => clearSlot(card.item_id, "front")} />
                        <Slot side="back" existingPath={card.back_image_path} staged={a.back} dragRef={draggingRef}
                          onDropPool={() => assignFromPool(card.item_id, "back")}
                          onPick={(f) => pickForSlot(card.item_id, "back", f)}
                          onClear={() => clearSlot(card.item_id, "back")} />
                      </div>
                      <div style={{ marginTop: 6, fontSize: "var(--text-xs)", lineHeight: 1.3, textAlign: "center" }}>
                        <div style={{ fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {card.members?.join(", ") || `#${card.item_id}`}
                        </div>
                        {(card.version || card.source_origin) && (
                          <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[card.source_origin, card.version].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {pageCount > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <button type="button" style={btnSecondary} disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Prev</button>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Page {safePage + 1} of {pageCount}</span>
                <button type="button" style={btnSecondary} disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
