import CardCaption from "./CardCaption";

const BACKEND_BASE_URL = "http://127.0.0.1:8000";

function toImageUrl(path) {
  if (!path) return "";

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (path.startsWith("/")) {
    return `${BACKEND_BASE_URL}${path}`;
  }

  return `${BACKEND_BASE_URL}/${path}`;
}

function getOwnershipBadge(status) {
  if (!status) return null;

  switch (status) {
    case "Owned":
      return { label: "O", color: "#00ff66" }; // bright green
    case "Want":
      return { label: "W", color: "#ffd600" }; // yellow
    case "For Trade":
      return { label: "T", color: "#ff3b3b" }; // red
    default:
      return null;
  }
}

export default function CardGridItem({
  card,
  imagePath,
  captionsEnabled,
  showMissingBackBadge,
  onClick,
  isSelectMode = false,
  isSelected = false,
}) {
  const badge = getOwnershipBadge(card.ownership_status);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        display: "block",
        background: "var(--bg-base)",
        border: isSelected ? "3px solid var(--selection-border)" : "1px solid var(--border-input)",
        borderRadius: 8,
        padding: 4,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {isSelectMode ? (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 16,
            height: 16,
            borderRadius: 3,
            border: "1px solid var(--border-input)",
            background: isSelected ? "var(--selection-border)" : "var(--bg-base)",
            zIndex: 3,
          }}
        />
      ) : null}

      <div style={{ position: "relative" }}>
        <img
          src={toImageUrl(imagePath)}
          alt={`${card.member || "Card"} front`}
          style={{
            width: "100%",
            aspectRatio: "55 / 85",
            objectFit: "cover",
            display: "block",
            borderRadius: 4,
          }}
        />

        {badge ? (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: 4,
              background: "#000",
              color: badge.color,
              fontWeight: 700,
              fontSize: 12,
              lineHeight: "12px",
              padding: "3px 5px",
              borderRadius: 4,
              zIndex: 2,
            }}
          >
            {badge.label}
          </div>
        ) : null}
      </div>

      {showMissingBackBadge ? (
        <div style={{ fontSize: 11, marginTop: 4 }}>Missing back</div>
      ) : null}

      {captionsEnabled ? <CardCaption card={card} /> : null}
    </button>
  );
}