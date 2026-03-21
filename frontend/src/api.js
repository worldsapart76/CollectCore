const API = "http://127.0.0.1:8000";

export async function fetchInbox() {
  const res = await fetch(`${API}/inbox`);
  if (!res.ok) throw new Error("Failed to fetch inbox");
  return res.json();
}

export async function fetchSubcategoryOptions(groupCode, topLevelCategory) {
  const res = await fetch(
    `${API}/subcategory-options?group_code=${encodeURIComponent(
      groupCode
    )}&top_level_category=${encodeURIComponent(topLevelCategory)}`
  );
  if (!res.ok) throw new Error("Failed to fetch subcategory options");
  return res.json();
}

export async function fetchSourceOptions(groupCode, topLevelCategory, subCategory) {
  const res = await fetch(
    `${API}/source-options?group_code=${encodeURIComponent(
      groupCode
    )}&top_level_category=${encodeURIComponent(
      topLevelCategory
    )}&sub_category=${encodeURIComponent(subCategory)}`
  );
  if (!res.ok) throw new Error("Failed to fetch source options");
  return res.json();
}

export async function ingestFront({
  filename,
  groupCode,
  member,
  topLevelCategory,
  subCategory,
  version,
  ownershipStatus,
  price,
}) {
  const params = new URLSearchParams({
    filename,
    group_code: groupCode,
    member,
    top_level_category: topLevelCategory,
    sub_category: subCategory,
    ownership_status: ownershipStatus,
  });

  if (version !== "" && version !== null && version !== undefined) {
    params.append("source", String(version));
  }

  if (price !== "" && price !== null && price !== undefined) {
    params.append("price", String(price));
  }

  const res = await fetch(`${API}/ingest/front?${params.toString()}`, {
    method: "POST",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Failed to ingest front");
  }

  return res.json();
}

export async function fetchCardCandidates({
  groupCode,
  member,
  topLevelCategory,
  subCategory,
  includeCardsWithBack = false,
}) {
  const params = new URLSearchParams({
    group_code: groupCode,
    member,
    top_level_category: topLevelCategory,
    sub_category: subCategory,
    include_cards_with_back: includeCardsWithBack ? "true" : "false",
  });

  const res = await fetch(`${API}/card-candidates?${params.toString()}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Failed to fetch card candidates");
  }
  return res.json();
}

export async function attachBack({ cardId, filename, forceReplace = false }) {
  const params = new URLSearchParams({
    card_id: String(cardId),
    filename,
    force_replace: forceReplace ? "true" : "false",
  });

  const res = await fetch(`${API}/attach-back?${params.toString()}`, {
    method: "POST",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Failed to attach back");
  }

  return res.json();
}