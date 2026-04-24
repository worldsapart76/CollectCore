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
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import {
  Alert,
  Button,
  Card,
  CoverThumb,
  FormField,
  Grid,
  Input,
  RemoveButton,
  Row,
  Select,
  Stack,
  Textarea,
} from "../components/primitives";

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
    <Stack gap={4}>
      {copies.map((copy, i) => (
        <Card key={i} surface style={{ padding: "var(--space-4) var(--space-5)" }}>
          <Stack gap={3}>
            <Row justify="between">
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" }}>
                Copy {i + 1}
              </span>
              <RemoveButton showLabel label="Remove" onClick={() => remove(i)} />
            </Row>
            <Grid cols={2} gap={4}>
              <FormField label="Format">
                <Select value={copy.format_type_id} onChange={e => update(i, "format_type_id", e.target.value)}>
                  <option value="">Select…</option>
                  {formatTypes.map(f => (
                    <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Ownership">
                <Select value={copy.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                  ))}
                </Select>
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="ISBN-13">
                <Input value={copy.isbn_13} onChange={e => update(i, "isbn_13", e.target.value)} placeholder="978-…" />
              </FormField>
              <FormField label="ISBN-10">
                <Input value={copy.isbn_10} onChange={e => update(i, "isbn_10", e.target.value)} placeholder="0-…" />
              </FormField>
            </Grid>
            <FormField label="Notes">
              <Input value={copy.notes} onChange={e => update(i, "notes", e.target.value)} placeholder="e.g. Signed copy" />
            </FormField>
          </Stack>
        </Card>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add Copy
      </Button>
    </Stack>
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
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.ttrpg),
      fetchTtrpgBookTypes(),
      fetchTtrpgFormatTypes(),
    ]).then(([sys, own, bt, ft]) => {
      setSystems(sys);
      setOwnershipStatuses(own);
      setBookTypes(bt);
      setFormatTypes(ft);
      setForm(blankForm(own));
    });
  }, []);

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
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
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

  if (!form) return (
    <PageContainer>
      <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "var(--space-7) 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-7)", color: "var(--text-primary)" }}>
          Add TTRPG Book
        </h2>

        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          <form onSubmit={handleSubmit}>
            <Stack gap={5}>
              <FormField label="Title" required>
                <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Player's Handbook" autoFocus />
              </FormField>

              <Grid cols={2} gap={5}>
                <FormField label="Game System" required>
                  <Select value={form.systemId} onChange={e => { set("systemId", e.target.value); set("systemEditionName", ""); set("lineName", ""); }}>
                    <option value="">Select…</option>
                    {systems.map(s => (
                      <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Ownership" required>
                  <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                    <option value="">Select…</option>
                    {ownershipStatuses.map(s => (
                      <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                    ))}
                  </Select>
                </FormField>
              </Grid>

              <Grid cols={2} gap={5}>
                <FormField label="System Edition">
                  <Input
                    value={form.systemEditionName}
                    onChange={e => set("systemEditionName", e.target.value)}
                    placeholder={form.systemId ? "e.g. 5e, 2e, 1st ed." : "Select a system first"}
                    disabled={!form.systemId}
                    list="edition-list"
                  />
                  <datalist id="edition-list">
                    {systemEditions.map(ed => <option key={ed.edition_id} value={ed.edition_name} />)}
                  </datalist>
                </FormField>
                <FormField label="Line / Setting">
                  <Input
                    value={form.lineName}
                    onChange={e => set("lineName", e.target.value)}
                    placeholder={form.systemId ? "e.g. Forgotten Realms" : "Select a system first"}
                    disabled={!form.systemId}
                    list="line-list"
                  />
                  <datalist id="line-list">
                    {lines.map(ln => <option key={ln.line_id} value={ln.line_name} />)}
                  </datalist>
                </FormField>
              </Grid>

              <Grid cols={2} gap={5}>
                <FormField label="Book Type">
                  <Select value={form.bookTypeId} onChange={e => set("bookTypeId", e.target.value)}>
                    <option value="">Select…</option>
                    {bookTypes.map(bt => (
                      <option key={bt.book_type_id} value={bt.book_type_id}>{bt.book_type_name}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Release Date">
                  <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY or YYYY-MM-DD" />
                </FormField>
              </Grid>

              <FormField label="Publisher">
                <Input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} placeholder="e.g. Wizards of the Coast" />
              </FormField>

              <FormField label="Author(s)">
                <NameList names={form.authors} onChange={v => set("authors", v)} addLabel="+ Author" placeholder="e.g. Gary Gygax" />
              </FormField>

              <FormField label="Cover Image URL">
                <Row gap={3} align="start">
                  <Input
                    value={form.coverImageUrl}
                    onChange={e => { set("coverImageUrl", e.target.value); setCoverPreview(e.target.value || null); }}
                    placeholder="https://…"
                    style={{ flex: 1 }}
                  />
                  <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                  <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                    Add Image
                  </Button>
                  {coverPreview && <CoverThumb src={coverPreview} alt="cover preview" size="md" />}
                </Row>
              </FormField>

              <FormField label="Description">
                <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
              </FormField>

              <FormField label="Notes">
                <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
              </FormField>

              <FormField label="Copies / Formats">
                <CopiesEditor
                  copies={form.copies}
                  formatTypes={formatTypes}
                  ownershipStatuses={ownershipStatuses}
                  onChange={v => set("copies", v)}
                />
              </FormField>

              <Row gap={4}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Book"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleReset}>
                  Clear
                </Button>
              </Row>
            </Stack>
          </form>
        </Stack>
      </div>
    </PageContainer>
  );
}
