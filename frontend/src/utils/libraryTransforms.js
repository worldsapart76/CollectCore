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

export function buildDisplayItems(cards, viewMode) {
  if (viewMode === "fronts") {
    return cards
      .filter((card) => card.front_image_path)
      .map((card) => ({
        type: "single",
        card,
        imagePath: toImageUrl(card.front_image_path, card.front_image_version),
        missingBack: !card.back_image_path,
      }));
  }

  return cards
    .filter((card) => card.front_image_path)
    .map((card) => {
      if (card.back_image_path) {
        return {
          type: "pair",
          card,
          frontImagePath: toImageUrl(card.front_image_path, card.front_image_version),
          backImagePath: toImageUrl(card.back_image_path, card.back_image_version),
        };
      }

      return {
        type: "single",
        card,
        imagePath: toImageUrl(card.front_image_path, card.front_image_version),
        missingBack: true,
      };
    });
}