export default function Alert({
  tone = "info",
  className = "",
  children,
  ...rest
}) {
  const cls = `cc-alert cc-alert--${tone}${className ? " " + className : ""}`;
  return (
    <div className={cls} role={tone === "error" ? "alert" : "status"} {...rest}>
      {children}
    </div>
  );
}
