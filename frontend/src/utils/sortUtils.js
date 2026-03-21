import { getMembersForGroup } from "./groupUtils";

function compareByCustomMemberOrder(aMember, bMember, groupCode = "skz") {
  const order = getMembersForGroup(groupCode);

  const aIndex = order.indexOf(aMember);
  const bIndex = order.indexOf(bMember);

  const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
  const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;

  if (safeA !== safeB) {
    return safeA - safeB;
  }

  return String(aMember || "").localeCompare(String(bMember || ""));
}

export function sortCards(cards, sortMode) {
  const sorted = [...cards];

  switch (sortMode) {
    case "id-desc":
      return sorted.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

    case "member":
      return sorted.sort((a, b) => {
        const groupCompare = String(a.group_code ?? "").localeCompare(String(b.group_code ?? ""));
        if (groupCompare !== 0) {
          return groupCompare;
        }

        return compareByCustomMemberOrder(a.member, b.member, a.group_code || "skz");
      });

    case "category":
      return sorted.sort((a, b) => {
        const aValue = `${a.top_level_category ?? ""} ${a.sub_category ?? ""}`;
        const bValue = `${b.top_level_category ?? ""} ${b.sub_category ?? ""}`;
        return aValue.localeCompare(bValue);
      });

    case "newest":
      return sorted.sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() -
          new Date(a.created_at ?? 0).getTime()
      );

    case "oldest":
      return sorted.sort(
        (a, b) =>
          new Date(a.created_at ?? 0).getTime() -
          new Date(b.created_at ?? 0).getTime()
      );

    case "id-asc":
    default:
      return sorted.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }
}