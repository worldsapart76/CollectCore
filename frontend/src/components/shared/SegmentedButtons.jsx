import { btnSm } from "../../styles/commonStyles";

export function ToggleButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      ...btnSm,
      background: active ? "var(--green-light)" : "var(--btn-secondary-bg)",
      color: active ? "var(--green)" : "var(--btn-secondary-text)",
      border: active ? "1px solid var(--green)" : "1px solid var(--btn-secondary-border)",
    }}>
      {children}
    </button>
  );
}

export function SegmentedButtons({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--btn-secondary-border)", borderRadius: 3, overflow: "hidden" }}>
      {options.map((opt, i) => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)} style={{
          fontSize: 11, padding: "2px 8px", cursor: "pointer",
          background: value === opt.value ? "var(--btn-primary-bg)" : "var(--bg-surface)",
          color: value === opt.value ? "var(--btn-primary-text)" : "var(--text-primary)",
          border: "none",
          borderRight: i < options.length - 1 ? "1px solid var(--btn-secondary-border)" : "none",
        }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
