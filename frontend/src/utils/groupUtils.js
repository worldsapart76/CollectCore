import { GROUPS } from "../config/groups";

export function getGroupLabel(groupCode) {
  return GROUPS[groupCode]?.label || groupCode || "—";
}

export function getMembersForGroup(groupCode) {
  return GROUPS[groupCode]?.members || [];
}

export function sortMembersForGroup(members, groupCode) {
  const order = getMembersForGroup(groupCode);

  return [...members].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);

    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;

    if (safeA !== safeB) {
      return safeA - safeB;
    }

    return String(a || "").localeCompare(String(b || ""));
  });
}