import { useEffect, useMemo, useState } from "react";
import { getMembersForGroup } from "../../utils/groupUtils";

const standardActionOptions = [
  { value: "leave", label: "Leave unchanged" },
  { value: "set", label: "Set value" },
  { value: "clear", label: "Clear value" },
];

const requiredActionOptions = [
  { value: "leave", label: "Leave unchanged" },
  { value: "set", label: "Set value" },
];

const notesActionOptions = [
  { value: "leave", label: "Leave unchanged" },
  { value: "set", label: "Replace with value" },
  { value: "append", label: "Append text" },
  { value: "clear", label: "Clear value" },
];

const ownershipOptions = ["Owned", "Want", "For Trade"];
const categoryOptions = ["Album", "Non-Album"];

const initialState = {
  memberAction: "leave",
  memberValue: "",

  categoryAction: "leave",
  categoryValue: "",

  subcategoryAction: "leave",
  subcategoryValue: "",

  versionAction: "leave",
  versionValue: "",

  ownershipAction: "leave",
  ownershipValue: "",

  priceAction: "leave",
  priceValue: "",

  notesAction: "leave",
  notesValue: "",
};

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(Boolean))];
}

function FieldActionRow({
  label,
  action,
  onActionChange,
  options,
  disabled = false,
  helperText = "",
  children,
}) {
  return (
    <div
      style={{
        marginBottom: 14,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>

      <select
        value={disabled ? "leave" : action}
        onChange={(e) => onActionChange(e.target.value)}
        disabled={disabled}
        style={{ width: "100%", marginBottom: action !== "leave" ? 6 : 0 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {helperText ? (
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{helperText}</div>
      ) : null}

      {!disabled && action !== "leave" && action !== "clear" ? (
        <div style={{ marginTop: 6 }}>{children}</div>
      ) : null}
    </div>
  );
}

export default function BulkEditPanel({
  isOpen,
  selectedCount,
  selectedCards = [],
  allCards = [],
  onClose,
  onApply,
  isApplying = false,
}) {
  const [formState, setFormState] = useState(initialState);

  const selectedGroups = useMemo(() => {
    return uniqueNonEmpty(selectedCards.map((card) => card.group_code));
  }, [selectedCards]);

  const selectedCategories = useMemo(() => {
    return uniqueNonEmpty(selectedCards.map((card) => card.top_level_category));
  }, [selectedCards]);

  const resolvedGroupCode = selectedGroups.length === 1 ? selectedGroups[0] : "";
  const memberOptions = resolvedGroupCode ? getMembersForGroup(resolvedGroupCode) : [];

  const resolvedCategory = useMemo(() => {
    if (formState.categoryAction === "set") {
      return formState.categoryValue || "";
    }

    return selectedCategories.length === 1 ? selectedCategories[0] : "";
  }, [formState.categoryAction, formState.categoryValue, selectedCategories]);

  const resolvedSubcategory = useMemo(() => {
    if (formState.subcategoryAction === "set") {
      return formState.subcategoryValue.trim();
    }

    if (formState.subcategoryAction === "clear") {
      return "";
    }

    const currentSubcategories = uniqueNonEmpty(
      selectedCards.map((card) => card.sub_category)
    );

    return currentSubcategories.length === 1 ? currentSubcategories[0] : "";
  }, [
    formState.subcategoryAction,
    formState.subcategoryValue,
    selectedCards,
  ]);

  const memberCompatibility = useMemo(() => {
    if (selectedCount === 0) {
      return {
        enabled: false,
        helperText: "Disabled: no cards selected.",
      };
    }

    if (selectedGroups.length !== 1) {
      return {
        enabled: false,
        helperText: "Disabled: selected cards do not share a single Group.",
      };
    }

    return {
      enabled: true,
      helperText: `Applies within group: ${resolvedGroupCode.toUpperCase()}`,
    };
  }, [selectedCount, selectedGroups, resolvedGroupCode]);

  const subcategoryCompatibility = useMemo(() => {
    if (selectedCount === 0) {
      return {
        enabled: false,
        helperText: "Disabled: no cards selected.",
      };
    }

    if (selectedGroups.length !== 1) {
      return {
        enabled: false,
        helperText: "Disabled: selected cards do not share a single Group.",
      };
    }

    if (!resolvedCategory) {
      return {
        enabled: false,
        helperText:
          "Disabled: selected cards do not share a single Group + Category. Set Category first to unlock this.",
      };
    }

    return {
      enabled: true,
      helperText: `Applies within ${resolvedGroupCode.toUpperCase()} + ${resolvedCategory}`,
    };
  }, [selectedCount, selectedGroups, resolvedGroupCode, resolvedCategory]);

  const versionCompatibility = useMemo(() => {
    if (selectedCount === 0) {
      return {
        enabled: false,
        helperText: "Disabled: no cards selected.",
      };
    }

    if (selectedGroups.length !== 1) {
      return {
        enabled: false,
        helperText: "Disabled: selected cards do not share a single Group.",
      };
    }

    if (!resolvedCategory) {
      return {
        enabled: false,
        helperText:
          "Disabled: selected cards do not share a single Group + Category. Set Category first to unlock this.",
      };
    }

    if (!resolvedSubcategory) {
      return {
        enabled: false,
        helperText:
          "Disabled: selected cards do not share a single Group + Category + Subcategory. Set Subcategory first to unlock this.",
      };
    }

    return {
      enabled: true,
      helperText: `Applies within ${resolvedGroupCode.toUpperCase()} + ${resolvedCategory} + ${resolvedSubcategory}`,
    };
  }, [
    selectedCount,
    selectedGroups,
    resolvedGroupCode,
    resolvedCategory,
    resolvedSubcategory,
  ]);

  const subcategorySuggestions = useMemo(() => {
    if (!resolvedGroupCode || !resolvedCategory) return [];

    return uniqueNonEmpty(
      allCards
        .filter(
          (card) =>
            card.group_code === resolvedGroupCode &&
            card.top_level_category === resolvedCategory
        )
        .map((card) => card.sub_category)
    ).sort((a, b) => a.localeCompare(b));
  }, [allCards, resolvedGroupCode, resolvedCategory]);

  const versionSuggestions = useMemo(() => {
    if (!resolvedGroupCode || !resolvedCategory || !resolvedSubcategory) return [];

    return uniqueNonEmpty(
      allCards
        .filter(
          (card) =>
            card.group_code === resolvedGroupCode &&
            card.top_level_category === resolvedCategory &&
            card.sub_category === resolvedSubcategory
        )
        .map((card) => card.source)
    ).sort((a, b) => a.localeCompare(b));
  }, [allCards, resolvedGroupCode, resolvedCategory, resolvedSubcategory]);

  useEffect(() => {
    if (!memberCompatibility.enabled && formState.memberAction !== "leave") {
      setFormState((prev) => ({ ...prev, memberAction: "leave" }));
    }
  }, [memberCompatibility.enabled, formState.memberAction]);

  useEffect(() => {
    if (!subcategoryCompatibility.enabled && formState.subcategoryAction !== "leave") {
      setFormState((prev) => ({ ...prev, subcategoryAction: "leave" }));
    }
  }, [subcategoryCompatibility.enabled, formState.subcategoryAction]);

  useEffect(() => {
    if (!versionCompatibility.enabled && formState.versionAction !== "leave") {
      setFormState((prev) => ({ ...prev, versionAction: "leave" }));
    }
  }, [versionCompatibility.enabled, formState.versionAction]);

  const hasChanges = useMemo(() => {
    return (
      formState.memberAction !== "leave" ||
      formState.categoryAction !== "leave" ||
      formState.subcategoryAction !== "leave" ||
      formState.versionAction !== "leave" ||
      formState.ownershipAction !== "leave" ||
      formState.priceAction !== "leave" ||
      formState.notesAction !== "leave"
    );
  }, [formState]);

  const hasMissingRequiredValue = useMemo(() => {
    if (formState.memberAction === "set" && !formState.memberValue) return true;
    if (formState.categoryAction === "set" && !formState.categoryValue) return true;
    if (formState.ownershipAction === "set" && !formState.ownershipValue) return true;
    if (
      formState.subcategoryAction === "set" &&
      !formState.subcategoryValue.trim()
    ) {
      return true;
    }
    if (formState.versionAction === "set" && !formState.versionValue.trim()) {
      return true;
    }
    if (
      (formState.notesAction === "set" || formState.notesAction === "append") &&
      !formState.notesValue.trim()
    ) {
      return true;
    }
    return false;
  }, [formState]);

  const canApply = hasChanges && !hasMissingRequiredValue && !isApplying;

  function updateField(key, value) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function handleClose() {
    if (isApplying) return;
    setFormState(initialState);
    onClose();
  }

  function buildPayload() {
    return {
      member: {
        action: formState.memberAction,
        value: formState.memberValue,
      },
      top_level_category: {
        action: formState.categoryAction,
        value: formState.categoryValue,
      },
      sub_category: {
        action: formState.subcategoryAction,
        value: formState.subcategoryValue,
      },
      source: {
        action: formState.versionAction,
        value: formState.versionValue,
      },
      ownership_status: {
        action: formState.ownershipAction,
        value: formState.ownershipValue,
      },
      price: {
        action: formState.priceAction,
        value: formState.priceValue,
      },
      notes: {
        action: formState.notesAction,
        value: formState.notesValue,
      },
    };
  }

  async function handleApply() {
    if (!canApply) return;
    await onApply(buildPayload());
    setFormState(initialState);
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        width: 340,
        minWidth: 340,
        borderLeft: "1px solid #ccc",
        padding: 14,
        background: "#fafafa",
        alignSelf: "stretch",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Bulk Edit</div>
          <div style={{ fontSize: 13, color: "#555" }}>{selectedCount} selected</div>
        </div>

        <button type="button" onClick={handleClose} disabled={isApplying}>
          Close
        </button>
      </div>

      <div style={{ fontSize: 13, color: "#555", marginBottom: 14 }}>
        Choose how each field should be handled for the selected cards.
      </div>

      <FieldActionRow
        label="Member"
        action={formState.memberAction}
        onActionChange={(value) => updateField("memberAction", value)}
        options={requiredActionOptions}
        disabled={!memberCompatibility.enabled}
        helperText={memberCompatibility.helperText}
      >
        <select
          value={formState.memberValue}
          onChange={(e) => updateField("memberValue", e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="">—</option>
          {memberOptions.map((member) => (
            <option key={member} value={member}>
              {member}
            </option>
          ))}
        </select>
      </FieldActionRow>

      <FieldActionRow
        label="Category"
        action={formState.categoryAction}
        onActionChange={(value) => updateField("categoryAction", value)}
        options={requiredActionOptions}
        helperText="Always available. Changing this can unlock Subcategory and Version."
      >
        <select
          value={formState.categoryValue}
          onChange={(e) => updateField("categoryValue", e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="">—</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </FieldActionRow>

      <FieldActionRow
        label="Subcategory"
        action={formState.subcategoryAction}
        onActionChange={(value) => updateField("subcategoryAction", value)}
        options={standardActionOptions}
        disabled={!subcategoryCompatibility.enabled}
        helperText={subcategoryCompatibility.helperText}
      >
        <>
          <input
            type="text"
            list="bulk-subcategory-options"
            value={formState.subcategoryValue}
            onChange={(e) => updateField("subcategoryValue", e.target.value)}
            style={{ width: "100%" }}
          />
          <datalist id="bulk-subcategory-options">
            {subcategorySuggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </>
      </FieldActionRow>

      <FieldActionRow
        label="Version"
        action={formState.versionAction}
        onActionChange={(value) => updateField("versionAction", value)}
        options={standardActionOptions}
        disabled={!versionCompatibility.enabled}
        helperText={versionCompatibility.helperText}
      >
        <>
          <input
            type="text"
            list="bulk-version-options"
            value={formState.versionValue}
            onChange={(e) => updateField("versionValue", e.target.value)}
            style={{ width: "100%" }}
          />
          <datalist id="bulk-version-options">
            {versionSuggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </>
      </FieldActionRow>

      <FieldActionRow
        label="Ownership Status"
        action={formState.ownershipAction}
        onActionChange={(value) => updateField("ownershipAction", value)}
        options={requiredActionOptions}
        helperText="Always available."
      >
        <select
          value={formState.ownershipValue}
          onChange={(e) => updateField("ownershipValue", e.target.value)}
          style={{ width: "100%" }}
        >
          <option value="">—</option>
          {ownershipOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </FieldActionRow>

      <FieldActionRow
        label="Price"
        action={formState.priceAction}
        onActionChange={(value) => updateField("priceAction", value)}
        options={standardActionOptions}
        helperText="Always available."
      >
        <input
          type="number"
          value={formState.priceValue}
          onChange={(e) => updateField("priceValue", e.target.value)}
          style={{ width: "100%" }}
        />
      </FieldActionRow>

      <FieldActionRow
        label="Notes"
        action={formState.notesAction}
        onActionChange={(value) => updateField("notesAction", value)}
        options={notesActionOptions}
        helperText="Always available."
      >
        <textarea
          rows="4"
          value={formState.notesValue}
          onChange={(e) => updateField("notesValue", e.target.value)}
          style={{ width: "100%" }}
        />
      </FieldActionRow>

      {hasMissingRequiredValue ? (
        <div style={{ fontSize: 12, color: "#a33", marginBottom: 10 }}>
          Fill in the value for any field set to “Set value” or “Append text” before applying.
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleApply}
        disabled={!canApply}
        style={{ width: "100%" }}
      >
        {isApplying ? "Applying..." : "Apply Changes"}
      </button>
    </div>
  );
}