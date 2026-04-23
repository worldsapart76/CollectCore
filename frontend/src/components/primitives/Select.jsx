export default function Select({
  size = "md",
  invalid = false,
  className = "",
  children,
  ...rest
}) {
  const cls = `cc-select cc-select--${size}${invalid ? " cc-select--invalid" : ""}${className ? " " + className : ""}`;
  return (
    <select className={cls} {...rest}>
      {children}
    </select>
  );
}
