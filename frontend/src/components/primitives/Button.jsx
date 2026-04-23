export default function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const cls = `cc-btn cc-btn--${variant} cc-btn--${size}${className ? " " + className : ""}`;
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
