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
      return { label: "O", color: "#00ff66" };
    case "Want":
      return { label: "W", color: "#ffd600" };
    case "For Trade":
      return { label: "T", color: "#ff3b3b" };
    default:
      return null;
  }
}

export default function CardPairItem({
  card,
  frontImagePath,
  backImagePath,
  captionsEnabled,
  onClick,
  isSelectMode = false,
  isSelected = false,
}) {
  const badge = getOwnershipBadge(card.ownership_status);

  return (
    <button
      type="button"
      className={`card-pair-item${isSelected ? " selected" : ""}`}
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        background: "transparent",
        border: isSelected ? "3px solid #4a67ff" : "1px solid #ccc",
        borderRadius: 8,
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
        overflow: "hidden",
        display: "block",
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
            border: "1px solid #666",
            background: isSelected ? "#4a67ff" : "#fff",
            zIndex: 3,
          }}
        />
      ) : null}

      <div
        className="card-pair-images"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          width: "100%",
        }}
      >
        <div
          style={{
            position: "relative",
            aspectRatio: "2.5 / 3.5",
            overflow: "hidden",
            borderRight: "1px solid #ddd",
            background: "#fff",
          }}
        >
          <img
            src={toImageUrl(frontImagePath)}
            alt={`${card.member || "Card"} front`}
            className="card-grid-image"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
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

        <div
          style={{
            aspectRatio: "2.5 / 3.5",
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <img
            src={toImageUrl(backImagePath)}
            alt={`${card.member || "Card"} back`}
            className="card-grid-image"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </div>

      {captionsEnabled ? <CardCaption card={card} /> : null}
    </button>
  );
}