import CardGridItem from "./CardGridItem";
import CardPairItem from "./CardPairItem";

const sizeMap = {
  s: 120,
  m: 160,
  l: 220,
};

export default function LibraryGrid({
  items,
  sizeMode,
  captionsEnabled,
  onSelectItem,
  isSelectMode = false,
  selectedCardIds = [],
}) {
  const cardWidth = sizeMap[sizeMode?.toLowerCase()] || sizeMap.m;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, ${cardWidth}px))`,
        gap: 12,
        alignItems: "start",
      }}
    >
      {items.map((item) => {
        const isSelected = selectedCardIds.includes(item.card.id);

        if (item.type === "pair") {
          return (
            <div
              key={`pair-wrap-${item.card.id}`}
              style={{
                gridColumn: "span 2",
                minWidth: 0,
              }}
            >
              <CardPairItem
                card={item.card}
                frontImagePath={item.frontImagePath}
                backImagePath={item.backImagePath}
                captionsEnabled={captionsEnabled}
                onClick={() => onSelectItem(item)}
                isSelectMode={isSelectMode}
                isSelected={isSelected}
              />
            </div>
          );
        }

        return (
          <CardGridItem
            key={`single-${item.card.id}`}
            card={item.card}
            imagePath={item.imagePath}
            captionsEnabled={captionsEnabled}
            showMissingBackBadge={Boolean(item.missingBack)}
            onClick={() => onSelectItem(item)}
            isSelectMode={isSelectMode}
            isSelected={isSelected}
          />
        );
      })}
    </div>
  );
}