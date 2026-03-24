import { useEffect, useMemo, useState } from "react";
import {
  fetchPhotocardGroups,
  fetchPhotocardMembers,
  fetchPhotocardSourceOrigins,
  fetchTopLevelCategories,
  createPhotocard,
  listPhotocards,
  createPhotocardSourceOrigin,
} from "./api";

export default function InboxManager() {
  const COLLECTION_TYPE_ID = 1;

  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [members, setMembers] = useState([]);
  const [sourceOrigins, setSourceOrigins] = useState([]);
  const [photocards, setPhotocards] = useState([]);

  const [groupId, setGroupId] = useState("");
  const [topLevelCategoryId, setTopLevelCategoryId] = useState("");
  const [ownershipStatusId, setOwnershipStatusId] = useState("1");
  const [sourceOriginId, setSourceOriginId] = useState("");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);

  const [showAddSourceOrigin, setShowAddSourceOrigin] = useState(false);
  const [newSourceOriginName, setNewSourceOriginName] = useState("");
  const [creatingSourceOrigin, setCreatingSourceOrigin] = useState(false);
  const [sourceOriginError, setSourceOriginError] = useState("");

  const [loadingFormData, setLoadingFormData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadPhotocards() {
    try {
      const data = await listPhotocards();
      setPhotocards(data);
    } catch (err) {
      setError(err.message || "Failed to load photocards");
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      setLoadingFormData(true);
      setError("");

      try {
        const [groupData, categoryData] = await Promise.all([
          fetchPhotocardGroups(),
          fetchTopLevelCategories(COLLECTION_TYPE_ID),
        ]);

        setGroups(groupData);
        setCategories(categoryData);

        if (groupData.length > 0) {
          setGroupId(String(groupData[0].group_id));
        }

        if (categoryData.length > 0) {
          setTopLevelCategoryId(String(categoryData[0].top_level_category_id));
        }

        await loadPhotocards();
      } catch (err) {
        setError(err.message || "Failed to load form data");
      } finally {
        setLoadingFormData(false);
      }
    }

    loadInitialData();
  }, []);

  useEffect(() => {
    async function loadMembers() {
      if (!groupId) {
        setMembers([]);
        setSelectedMemberIds([]);
        return;
      }

      try {
        const data = await fetchPhotocardMembers(groupId);
        setMembers(data);
        setSelectedMemberIds([]);
      } catch (err) {
        setError(err.message || "Failed to load members");
      }
    }

    loadMembers();
  }, [groupId]);

  useEffect(() => {
    async function loadSourceOrigins() {
      if (!groupId || !topLevelCategoryId) {
        setSourceOrigins([]);
        setSourceOriginId("");
        return;
      }

      try {
        const data = await fetchPhotocardSourceOrigins(
          groupId,
          topLevelCategoryId
        );
        setSourceOrigins(data);

        if (data.length > 0) {
          setSourceOriginId(String(data[0].source_origin_id));
        } else {
          setSourceOriginId("");
        }
      } catch (err) {
        setError(err.message || "Failed to load source origins");
      }
    }

    loadSourceOrigins();
  }, [groupId, topLevelCategoryId]);

  useEffect(() => {
    setShowAddSourceOrigin(false);
    setNewSourceOriginName("");
    setSourceOriginError("");
  }, [groupId, topLevelCategoryId]);

  const selectedGroupName = useMemo(() => {
    return (
      groups.find((g) => String(g.group_id) === String(groupId))
        ?.group_name || ""
    );
  }, [groups, groupId]);

  function toggleMember(memberId) {
    const id = String(memberId);
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  function selectAllMembers() {
    setSelectedMemberIds(members.map((m) => String(m.member_id)));
  }

  function clearMembers() {
    setSelectedMemberIds([]);
  }

  async function handleCreateSourceOrigin() {
    setSourceOriginError("");

    const trimmed = newSourceOriginName.trim();

    if (!groupId || !topLevelCategoryId) {
      setSourceOriginError("Select group and category first.");
      return;
    }

    if (!trimmed) {
      setSourceOriginError("Enter a name.");
      return;
    }

    try {
      setCreatingSourceOrigin(true);

      const created = await createPhotocardSourceOrigin({
        groupId: Number(groupId),
        categoryId: Number(topLevelCategoryId),
        sourceOriginName: trimmed,
      });

      const refreshed = await fetchPhotocardSourceOrigins(
        groupId,
        topLevelCategoryId
      );
      setSourceOrigins(refreshed);

      setSourceOriginId(String(created.source_origin_id));
      setNewSourceOriginName("");
      setShowAddSourceOrigin(false);
    } catch (err) {
      setSourceOriginError(
        err.message || "Failed to create source origin"
      );
    } finally {
      setCreatingSourceOrigin(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!groupId) {
      setError("Please select a group.");
      return;
    }

    if (!topLevelCategoryId) {
      setError("Please select a category.");
      return;
    }

    if (selectedMemberIds.length === 0) {
      setError("Please select at least one member.");
      return;
    }

    setSaving(true);

    try {
      const result = await createPhotocard({
        collectionTypeId: COLLECTION_TYPE_ID,
        topLevelCategoryId: Number(topLevelCategoryId),
        ownershipStatusId: Number(ownershipStatusId),
        notes: notes.trim() || null,
        groupId: Number(groupId),
        sourceOriginId: sourceOriginId ? Number(sourceOriginId) : null,
        version: version.trim() || null,
        memberIds: selectedMemberIds.map(Number),
      });

      setSuccessMessage(`Created photocard item ${result.item_id}`);
      setVersion("");
      setNotes("");
      setSelectedMemberIds([]);

      await loadPhotocards();
    } catch (err) {
      setError(err.message || "Failed to create photocard");
    } finally {
      setSaving(false);
    }
  }

  if (loadingFormData) {
    return <div style={{ padding: 16 }}>Loading CollectCore...</div>;
  }

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>CollectCore Photocard Tester</h1>
      <p style={{ marginTop: 0 }}>
        Current group: <strong>{selectedGroupName || "None selected"}</strong>
      </p>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #c62828", background: "#ffebee" }}>
          {error}
        </div>
      )}

      {successMessage && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #2e7d32", background: "#e8f5e9" }}>
          {successMessage}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 20 }}>
        <form onSubmit={handleSubmit} style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          <h2>Create Photocard</h2>

          {/* Group */}
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>
                {g.group_name}
              </option>
            ))}
          </select>

          {/* Category */}
          <select value={topLevelCategoryId} onChange={(e) => setTopLevelCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.top_level_category_id} value={c.top_level_category_id}>
                {c.category_name}
              </option>
            ))}
          </select>

          {/* Source Origin */}
          <div style={{ marginTop: 10 }}>
            <select
              value={sourceOriginId}
              onChange={(e) => setSourceOriginId(e.target.value)}
            >
              <option value="">-- None --</option>
              {sourceOrigins.map((o) => (
                <option key={o.source_origin_id} value={o.source_origin_id}>
                  {o.source_origin_name}
                </option>
              ))}
            </select>

            <button type="button" onClick={() => setShowAddSourceOrigin((p) => !p)}>
              + Add
            </button>

            {showAddSourceOrigin && (
              <div style={{ marginTop: 6 }}>
                <input
                  value={newSourceOriginName}
                  onChange={(e) => setNewSourceOriginName(e.target.value)}
                  placeholder="New source origin"
                />
                <button type="button" onClick={handleCreateSourceOrigin}>
                  Save
                </button>
                <button type="button" onClick={() => setShowAddSourceOrigin(false)}>
                  Cancel
                </button>

                {sourceOriginError && (
                  <div style={{ color: "red" }}>{sourceOriginError}</div>
                )}
              </div>
            )}
          </div>

          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Create"}
          </button>
        </form>

        <div>
          {photocards.map((card) => (
            <div key={card.item_id}>
              {card.group} - {card.source_origin}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}