export default function RemoveButton({
  label = "Remove",
  showLabel = false,
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const cls = `cc-remove-btn${className ? " " + className : ""}`;
  return (
    <button type={type} className={cls} aria-label={label} {...rest}>
      {children ?? (showLabel ? <>✕ {label}</> : "✕")}
    </button>
  );
}
