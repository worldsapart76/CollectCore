import { useMemo, useState } from "react";

export default function FilterSearchList({
  items = [],
  selectedItems = [],
  onToggleItem,
  searchable = false,
  searchPlaceholder = "Search...",
  formatItemLabel = (item) => item,
}) {
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchable || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter((item) => String(formatItemLabel(item)).toLowerCase().includes(q));
  }, [items, query, searchable, formatItemLabel]);

  return (
    <div className="filter-search-list">
      {searchable ? (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
        />
      ) : null}

      <div className="filter-checkbox-list">
        {filteredItems.map((item) => {
          const checked = selectedItems.includes(item);
          return (
            <label key={item} className="filter-checkbox-item">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleItem(item)}
              />
              <span>{formatItemLabel(item)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}