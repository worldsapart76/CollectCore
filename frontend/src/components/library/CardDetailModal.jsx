import { useEffect, useRef, useState } from "react";
import { getGroupLabel, getMembersForGroup } from "../../utils/groupUtils";

const BACKEND_BASE_URL = "http://127.0.0.1:8000";

function toImageUrl(path, imageVersion = null) {
  if (!path) return "";

  let url = "";

  if (path.startsWith("http://") || path.startsWith("https://")) {
    url = path;
  } else if (path.startsWith("/")) {
    url = `${BACKEND_BASE_URL}${path}`;
  } else {
    url = `${BACKEND_BASE_URL}/${path}`;
  }

  if (imageVersion) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}v=${imageVersion}`;
  }

  return url;
}

export default function CardDetailModal({ card, isOpen, onClose, onSaved, onDeleted }) {
  const [frontFailed, setFrontFailed] = useState(false);
  const [backFailed, setBackFailed] = useState(false);
  const [subcategoryOptions, setSubcategoryOptions] = useState([]);
  const [sourceOptions, setSourceOptions] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReplacingFront, setIsReplacingFront] = useState(false);
  const [isReplacingBack, setIsReplacingBack] = useState(false);
  const [saveError, setSaveError] = useState("");

  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);

  const [formData, setFormData] = useState({
    member: "",
    top_level_category: "",
    sub_category: "",
    source: "",
    ownership_status: "Owned",
    price: "",
    notes: "",
  });

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    setFrontFailed(false);
    setBackFailed(false);
    setSaveError("");
  }, [card, isOpen]);

  useEffect(() => {
    if (!card) return;

    setFormData({
      member: card.member || "",
      top_level_category: card.top_level_category || "",
      sub_category: card.sub_category || "",
      source: card.source || "",
      ownership_status: card.ownership_status || "Owned",
      price: card.price != null ? String(card.price) : "",
      notes: card.notes || "",
    });
  }, [card]);

  useEffect(() => {
    async function loadSubcategoryOptions() {
      if (!card?.group_code || !formData.top_level_category) {
        setSubcategoryOptions([]);
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_BASE_URL}/subcategory-options?group_code=${encodeURIComponent(
            card.group_code
          )}&top_level_category=${encodeURIComponent(formData.top_level_category)}`
        );

        if (!response.ok) {
          throw new Error(`Failed to load subcategory options: ${response.status}`);
        }

        const data = await response.json();
        setSubcategoryOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        setSubcategoryOptions([]);
      }
    }

    if (isOpen) {
      loadSubcategoryOptions();
    }
  }, [isOpen, card?.group_code, formData.top_level_category]);

  useEffect(() => {
    async function loadSourceOptions() {
      if (!card?.group_code || !formData.top_level_category || !formData.sub_category) {
        setSourceOptions([]);
        return;
      }

      try {
        const response = await fetch(
          `${BACKEND_BASE_URL}/source-options?group_code=${encodeURIComponent(
            card.group_code
          )}&top_level_category=${encodeURIComponent(
            formData.top_level_category
          )}&sub_category=${encodeURIComponent(formData.sub_category)}`
        );

        if (!response.ok) {
          throw new Error(`Failed to load source options: ${response.status}`);
        }

        const data = await response.json();
        setSourceOptions(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        setSourceOptions([]);
      }
    }

    if (isOpen) {
      loadSourceOptions();
    }
  }, [isOpen, card?.group_code, formData.top_level_category, formData.sub_category]);

  if (!isOpen || !card) return null;

  const frontUrl = toImageUrl(card.front_image_path, card.front_image_version);
  const backUrl = toImageUrl(card.back_image_path, card.back_image_version);
  const memberOptions = getMembersForGroup(card.group_code);

  function updateField(key, value) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError("");

    try {
      const payload = {
        member: formData.member || null,
        top_level_category: formData.top_level_category || null,
        sub_category: formData.sub_category || null,
        source: formData.source || null,
        ownership_status: formData.ownership_status || "Owned",
        price: formData.price === "" ? null : Number(formData.price),
        notes: formData.notes || null,
      };

      const response = await fetch(`${BACKEND_BASE_URL}/cards/${card.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
      }

      const updatedCard = await response.json();

      if (onSaved) {
        onSaved(updatedCard);
      }

      onClose();
    } catch (error) {
      console.error(error);
      setSaveError("Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete card #${card.id}? This removes the record from the library.`
    );

    if (!confirmed) return;

    setIsDeleting(true);
    setSaveError("");

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/cards/${card.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Delete failed with status ${response.status}`);
      }

      if (onDeleted) {
        onDeleted(card.id);
      }

      onClose();
    } catch (error) {
      console.error(error);
      setSaveError("Failed to delete card.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleFrontFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReplacingFront(true);
    setSaveError("");

    try {
      const formDataUpload = new FormData();
      formDataUpload.append("file", file);

      const uploadResponse = await fetch(`${BACKEND_BASE_URL}/upload-to-inbox`, {
        method: "POST",
        body: formDataUpload,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();
      const filename = uploadResult.filename;

      const replaceResponse = await fetch(
        `${BACKEND_BASE_URL}/cards/${card.id}/replace-front?filename=${encodeURIComponent(filename)}`,
        {
          method: "POST",
        }
      );

      if (!replaceResponse.ok) {
        throw new Error(`Replace front failed with status ${replaceResponse.status}`);
      }

      const updatedCard = await replaceResponse.json();

      setFrontFailed(false);

      if (onSaved) {
        onSaved(updatedCard);
      }

      onClose();
    } catch (error) {
      console.error(error);
      setSaveError("Failed to replace front image.");
    } finally {
      setIsReplacingFront(false);
      if (frontInputRef.current) {
        frontInputRef.current.value = "";
      }
    }
  }

  async function handleBackFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReplacingBack(true);
    setSaveError("");

    try {
      const formDataUpload = new FormData();
      formDataUpload.append("file", file);

      const uploadResponse = await fetch(`${BACKEND_BASE_URL}/upload-to-inbox`, {
        method: "POST",
        body: formDataUpload,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();
      const filename = uploadResult.filename;

      const replaceResponse = await fetch(
        `${BACKEND_BASE_URL}/cards/${card.id}/replace-back?filename=${encodeURIComponent(filename)}`,
        {
          method: "POST",
        }
      );

      if (!replaceResponse.ok) {
        throw new Error(`Replace back failed with status ${replaceResponse.status}`);
      }

      const updatedCard = await replaceResponse.json();

      setBackFailed(false);

      if (onSaved) {
        onSaved(updatedCard);
      }

      onClose();
    } catch (error) {
      console.error(error);
      setSaveError("Failed to replace back image.");
    } finally {
      setIsReplacingBack(false);
      if (backInputRef.current) {
        backInputRef.current.value = "";
      }
    }
  }

  function triggerFrontReplace() {
    frontInputRef.current?.click();
  }

  function triggerBackReplace() {
    backInputRef.current?.click();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-modal-header">
          <h2>Card #{card.id}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="card-modal-body">
          <div className="card-modal-images">
            <div className="card-modal-image-block">
              {card.front_image_path && !frontFailed ? (
                <img
                  src={frontUrl}
                  alt={`${card.member ?? "Card"} front`}
                  className="card-modal-image"
                  onError={() => setFrontFailed(true)}
                />
              ) : (
                <div className="card-modal-image-fallback">Front image unavailable</div>
              )}

              <input
                ref={frontInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFrontFileSelected}
              />

              <button
                type="button"
                onClick={triggerFrontReplace}
                disabled={isSaving || isDeleting || isReplacingFront || isReplacingBack}
              >
                {isReplacingFront ? "Replacing Front..." : "Replace Front"}
              </button>
            </div>

            <div className="card-modal-image-block">
              {card.back_image_path ? (
                !backFailed ? (
                  <img
                    src={backUrl}
                    alt={`${card.member ?? "Card"} back`}
                    className="card-modal-image"
                    onError={() => setBackFailed(true)}
                  />
                ) : (
                  <div className="card-modal-image-fallback">Back image unavailable</div>
                )
              ) : (
                <div className="card-modal-image-fallback">No back image</div>
              )}

              <input
                ref={backInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleBackFileSelected}
              />

              <button
                type="button"
                onClick={triggerBackReplace}
                disabled={isSaving || isDeleting || isReplacingFront || isReplacingBack}
              >
                {isReplacingBack ? "Replacing Back..." : "Replace Back"}
              </button>
            </div>
          </div>

          <div className="card-modal-meta">
            <div><strong>ID:</strong> {card.id ?? "—"}</div>
            <div><strong>Group:</strong> {getGroupLabel(card.group_code)}</div>

            <label className="card-modal-field">
              <span>Member</span>
              <select
                value={formData.member}
                onChange={(e) => updateField("member", e.target.value)}
              >
                <option value="">—</option>
                {memberOptions.map((member) => (
                  <option key={member} value={member}>
                    {member}
                  </option>
                ))}
              </select>
            </label>

            <label className="card-modal-field">
              <span>Category</span>
              <select
                value={formData.top_level_category}
                onChange={(e) => {
                  updateField("top_level_category", e.target.value);
                  updateField("sub_category", "");
                  updateField("source", "");
                }}
              >
                <option value="">—</option>
                <option value="Album">Album</option>
                <option value="Non-Album">Non-Album</option>
              </select>
            </label>

            <label className="card-modal-field">
              <span>Subcategory</span>
              <input
                type="text"
                list="subcategory-options"
                value={formData.sub_category}
                onChange={(e) => {
                  updateField("sub_category", e.target.value);
                  updateField("source", "");
                }}
              />
              <datalist id="subcategory-options">
                {subcategoryOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>

            <label className="card-modal-field">
              <span>Version</span>
              <input
                type="text"
                list="source-options"
                value={formData.source}
                onChange={(e) => updateField("source", e.target.value)}
              />
              <datalist id="source-options">
                {sourceOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>

            <label className="card-modal-field">
              <span>Ownership Status</span>
              <select
                value={formData.ownership_status}
                onChange={(e) => updateField("ownership_status", e.target.value)}
              >
                <option value="Owned">Owned</option>
                <option value="Want">Want</option>
                <option value="For Trade">For Trade</option>
              </select>
            </label>

            <label className="card-modal-field">
              <span>Price</span>
              <input
                type="number"
                value={formData.price}
                onChange={(e) => updateField("price", e.target.value)}
              />
            </label>

            <label className="card-modal-field">
              <span>Notes</span>
              <textarea
                rows="4"
                value={formData.notes}
                onChange={(e) => updateField("notes", e.target.value)}
              />
            </label>

            <div><strong>Created:</strong> {card.created_at || "—"}</div>

            {saveError ? <div className="modal-error">{saveError}</div> : null}

            <div className="card-modal-actions">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isDeleting || isReplacingFront || isReplacingBack}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleDelete}
                disabled={isSaving || isDeleting || isReplacingFront || isReplacingBack}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}