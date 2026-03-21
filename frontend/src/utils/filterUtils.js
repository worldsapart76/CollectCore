export function filterCards(cards, filters) {
  return cards.filter((card) => {
    const search = (filters.search || "").trim().toLowerCase();

    if (search) {
      const haystack = [
        card.notes,
        card.member,
        card.sub_category,
        card.top_level_category,
        card.group_code,
        card.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (filters.members.length > 0 && !filters.members.includes(card.member)) {
      return false;
    }

    if (filters.groupCodes.length > 0 && !filters.groupCodes.includes(card.group_code)) {
      return false;
    }

    if (
      filters.topLevelCategories.length > 0 &&
      !filters.topLevelCategories.includes(card.top_level_category)
    ) {
      return false;
    }

    if (
      filters.subCategories.length > 0 &&
      !filters.subCategories.includes(card.sub_category)
    ) {
      return false;
    }

    if (
      filters.version &&
      (card.source || "").toLowerCase() !== filters.version.toLowerCase()
    ) {
      return false;
    }

    if (
      filters.ownershipStatus &&
      filters.ownershipStatus.length > 0 &&
      !filters.ownershipStatus.includes(card.ownership_status)
    ) {
      return false;
    }

    if (filters.backStatus.length > 0) {
      const hasBack = Boolean(card.back_image_path);
      const matchesHasBack = filters.backStatus.includes("has-back") && hasBack;
      const matchesMissingBack = filters.backStatus.includes("missing-back") && !hasBack;

      if (!matchesHasBack && !matchesMissingBack) {
        return false;
      }
    }

    return true;
  });
}