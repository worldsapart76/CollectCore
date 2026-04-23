import Label from "./Label";

export default function FormField({
  label,
  htmlFor,
  required = false,
  helper,
  error,
  className = "",
  children,
}) {
  const cls = `cc-formfield${className ? " " + className : ""}`;
  return (
    <div className={cls}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error
        ? <div className="cc-formfield__error">{error}</div>
        : helper
          ? <div className="cc-formfield__helper">{helper}</div>
          : null}
    </div>
  );
}
