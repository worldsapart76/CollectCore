export function buildCardCaption(card) {
  const sub = card?.sub_category?.trim();
  const version = card?.source?.trim(); // still using backend field name

  if (sub && version) {
    return `${sub} | ${version}`;
  }

  if (sub) {
    return sub;
  }

  if (version) {
    return version;
  }

  return "—";
}