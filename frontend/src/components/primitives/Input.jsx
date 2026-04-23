export default function Input({
  size = "md",
  invalid = false,
  className = "",
  type = "text",
  ...rest
}) {
  const cls = `cc-input cc-input--${size}${invalid ? " cc-input--invalid" : ""}${className ? " " + className : ""}`;
  return <input type={type} className={cls} {...rest} />;
}
