/**
 * Shared photocard filter + sort logic.
 *
 * Extracted from PhotocardLibraryPage so the Binder Designer's card tray offers
 * the same filter sections and the same sort orders. That agreement is what
 * makes "a card removed from a pocket returns to its sort position" behave the
 * way the library trained you to expect — the tray is derived from this sorted
 * array, so there is no list to append to.
 *
 * Pure move from the library page — no behavior change.
 */
import {
  emptySection,
  sectionActive,
  applySection,
} from "../library/FilterSidebar";

// Stray Kids canonical member order — cards with multiple members sort to bottom
export const MEMBER_ORDER = [
  "Bang Chan", "Lee Know", "Changbin", "Hyunjin",
  "Han", "Felix", "Seungmin", "I.N",
];

export function memberSortKey(card) {
  const members = card.members || [];
  if (members.length !== 1) return MEMBER_ORDER.length; // multi → bottom
  const idx = MEMBER_ORDER.indexOf(members[0]);
  return idx === -1 ? MEMBER_ORDER.length - 0.5 : idx;
}

export const DEFAULT_FILTERS = {
  notesSearch: "",
  group: emptySection(),
  member: emptySection(),
  category: emptySection(),
  sourceOrigin: emptySection(),
  cardType: emptySection(),
  version: emptySection(),
  ownership: emptySection(),
  imageStatus: emptySection(),
  triage: emptySection(),
  market: emptySection(),
};

// Standing triage decisions (admin/photocards only). A card is "tracked" when it
// has at least one copy that is NOT one of these — i.e. a real possession fact.
// Deliberately card-level rather than an `ownership` exclusion: applySection's
// exclude is card-wide, so excluding `not_wanted` there would also hide a
// {not_wanted + trade} card and drop active trade inventory out of view.
export const TRIAGE_STATUS_CODES = ["undecided", "not_wanted"];

export function isCardTracked(card, triageStatusIds) {
  return (card.copies || []).some(
    (cp) => !triageStatusIds.has(cp.ownership_status_id)
  );
}

export const SORT_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "id_asc", label: "ID ↑" },
  { value: "id_desc", label: "ID ↓" },
  { value: "member", label: "Member" },
  { value: "category", label: "Category" },
  { value: "group", label: "Group" },
];

/** Derive the member list for the filter sidebar, in canonical member order. */
export function deriveFilterMembers(cards) {
  const memberMap = new Map();
  for (const card of cards) {
    if (card.members) {
      for (const name of card.members) {
        if (!memberMap.has(name)) {
          memberMap.set(name, { member_id: name, member_name: name });
        }
      }
    }
  }
  return [...memberMap.values()].sort((a, b) => {
    const ai = MEMBER_ORDER.indexOf(a.member_name);
    const bi = MEMBER_ORDER.indexOf(b.member_name);
    const aIdx = ai === -1 ? MEMBER_ORDER.length : ai;
    const bIdx = bi === -1 ? MEMBER_ORDER.length : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.member_name.localeCompare(b.member_name);
  });
}

/**
 * Version list for the filter sidebar, alphabetical. Scoped to the selected
 * source origin(s): versions are free-text per card and, post-canon, live under
 * a specific source origin, so only surface versions that appear in the
 * currently-selected origins (one-way, origin → version). No source origin
 * selected → all versions.
 */
export function deriveFilterVersions(cards, sourceOriginSection) {
  const originFilterActive = sectionActive(sourceOriginSection);
  const seen = new Map();
  for (const card of cards) {
    if (!card.version || seen.has(card.version)) continue;
    if (
      originFilterActive &&
      !applySection(sourceOriginSection, [String(card.source_origin_id)])
    ) {
      continue;
    }
    seen.set(card.version, { id: card.version, label: card.version });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Source origins for the filter sidebar — derived from the cards themselves. */
export function deriveFilterSourceOrigins(cards) {
  const soMap = new Map();
  for (const card of cards) {
    if (card.source_origin_id && card.source_origin) {
      if (!soMap.has(card.source_origin_id)) {
        soMap.set(card.source_origin_id, {
          source_origin_id: card.source_origin_id,
          source_origin_name: card.source_origin,
        });
      }
    }
  }
  return [...soMap.values()].sort((a, b) =>
    a.source_origin_name.localeCompare(b.source_origin_name)
  );
}

export function applyPhotocardFilters(cards, filters, triageStatusIds) {
  let result = cards;

  if (sectionActive(filters.group)) {
    result = result.filter((c) =>
      applySection(filters.group, [String(c.group_id)])
    );
  }

  if (sectionActive(filters.member)) {
    // member IDs in this sidebar are member names (derived from card data)
    result = result.filter((c) =>
      applySection(filters.member, c.members || [])
    );
  }

  if (sectionActive(filters.category)) {
    result = result.filter((c) =>
      applySection(filters.category, [String(c.top_level_category_id)])
    );
  }

  if (sectionActive(filters.sourceOrigin)) {
    result = result.filter((c) =>
      applySection(filters.sourceOrigin, [String(c.source_origin_id)])
    );
  }

  if (sectionActive(filters.cardType)) {
    result = result.filter((c) =>
      applySection(filters.cardType, [c.is_special ? "special" : "regular"])
    );
  }

  if (sectionActive(filters.version)) {
    result = result.filter((c) =>
      applySection(filters.version, [c.version || ""])
    );
  }

  if (sectionActive(filters.ownership)) {
    result = result.filter((c) =>
      applySection(filters.ownership, (c.copies || []).map((cp) => String(cp.ownership_status_id)))
    );
  }

  if (sectionActive(filters.imageStatus)) {
    result = result.filter((c) => {
      // A card emits a token for each side it's MISSING. Cards with both
      // images emit no tokens, so any active include filters them out.
      const missing = [];
      if (!c.front_image_path) missing.push("missing_front");
      if (!c.back_image_path) missing.push("missing_back");
      return applySection(filters.imageStatus, missing);
    });
  }

  // Whether the card has anything captured about it in the market module.
  // `card.market` is grafted on by the library page from /market/summary and is
  // absent on guest builds, where this section never renders -- so with no
  // summary loaded every card reads as `no_comps` and an accidental filter
  // would empty the library rather than silently mis-filter it.
  if (sectionActive(filters.market)) {
    result = result.filter((c) =>
      applySection(filters.market, [c.market ? "has_comps" : "no_comps"])
    );
  }

  if (sectionActive(filters.triage)) {
    result = result.filter((c) =>
      applySection(filters.triage, [
        isCardTracked(c, triageStatusIds) ? "tracked" : "untracked",
      ])
    );
  }

  if (filters.notesSearch?.trim()) {
    const q = filters.notesSearch.toLowerCase();
    result = result.filter(
      (c) =>
        c.notes?.toLowerCase().includes(q) ||
        c.copies?.some((cp) => cp.notes?.toLowerCase().includes(q)) ||
        c.members?.some((m) => m.toLowerCase().includes(q)) ||
        c.source_origin?.toLowerCase().includes(q) ||
        c.version?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.group_name?.toLowerCase().includes(q)
    );
  }

  return result;
}

export function sortPhotocards(cards, sortMode) {
  const result = [...cards];
  switch (sortMode) {
    case "id_desc":
      return result.sort((a, b) => b.item_id - a.item_id);
    case "member":
      return result.sort((a, b) => memberSortKey(a) - memberSortKey(b));
    case "category":
      return result.sort((a, b) =>
        (a.category || "").localeCompare(b.category || "")
      );
    case "group":
      return result.sort((a, b) =>
        (a.group_name || "").localeCompare(b.group_name || "")
      );
    case "id_asc":
      return result.sort((a, b) => a.item_id - b.item_id);
    case "default":
    default:
      return result.sort((a, b) => {
        const g = (a.group_name || "").localeCompare(b.group_name || "");
        if (g !== 0) return g;
        const c = (a.category || "").localeCompare(b.category || "");
        if (c !== 0) return c;
        const so = (a.source_origin || "").localeCompare(b.source_origin || "");
        if (so !== 0) return so;
        const ct = (a.is_special ? 1 : 0) - (b.is_special ? 1 : 0);
        if (ct !== 0) return ct;
        const v = (a.version || "").localeCompare(b.version || "");
        if (v !== 0) return v;
        return memberSortKey(a) - memberSortKey(b);
      });
  }
}
