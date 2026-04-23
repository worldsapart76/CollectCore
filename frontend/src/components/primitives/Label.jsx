export default function Label({
  htmlFor,
  required = false,
  className = "",
  children,
  ...rest
}) {
  const cls = `cc-label${className ? " " + className : ""}`;
  return (
    <label htmlFor={htmlFor} className={cls} {...rest}>
      {children}
      {required && <span className="cc-label__required" aria-hidden="true">*</span>}
    </label>
  );
}
