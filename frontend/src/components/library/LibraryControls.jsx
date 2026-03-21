export default function LibraryControls({
  viewMode,
  sizeMode,
  sortMode,
  captionsEnabled,
  onViewModeChange,
  onSizeModeChange,
  onSortModeChange,
  onCaptionsToggle,
  isSelectMode,
  onToggleSelectMode,
}) {
  return (
    <div className="library-controls">
      <div className="control-group">
        <label>View</label>
        <div className="segmented-control">
          <button
            type="button"
            className={viewMode === "fronts" ? "active" : ""}
            onClick={() => onViewModeChange("fronts")}
          >
            Fronts
          </button>
          <button
            type="button"
            className={viewMode === "fronts-and-backs" ? "active" : ""}
            onClick={() => onViewModeChange("fronts-and-backs")}
          >
            Fronts + Backs
          </button>
        </div>
      </div>

      <div className="control-group">
        <label>Size</label>
        <div className="segmented-control">
          {["S", "M", "L"].map((size) => (
            <button
              type="button"
              key={size}
              className={sizeMode === size ? "active" : ""}
              onClick={() => onSizeModeChange(size)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label>Sort</label>
        <select value={sortMode} onChange={(e) => onSortModeChange(e.target.value)}>
          <option value="id-asc">ID ↑</option>
          <option value="id-desc">ID ↓</option>
          <option value="member">Member</option>
          <option value="category">Category</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>

      <div className="control-group">
        <label>Captions</label>
        <button
          type="button"
          className={captionsEnabled ? "toggle-on" : "toggle-off"}
          onClick={() => onCaptionsToggle(!captionsEnabled)}
        >
          {captionsEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="control-group">
        <label>Select</label>
        <button
          type="button"
          className={isSelectMode ? "toggle-on" : "toggle-off"}
          onClick={onToggleSelectMode}
        >
          {isSelectMode ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}