export default function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  className = "",
  ...rest
}) {
  const cls = `cc-checkbox${disabled ? " cc-checkbox--disabled" : ""}${className ? " " + className : ""}`;
  return (
    <label className={cls}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      {label != null && <span>{label}</span>}
    </label>
  );
}
