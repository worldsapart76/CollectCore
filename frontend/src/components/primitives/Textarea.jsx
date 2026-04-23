export default function Textarea({
  size = "md",
  invalid = false,
  className = "",
  ...rest
}) {
  const cls = `cc-textarea cc-textarea--${size}${invalid ? " cc-textarea--invalid" : ""}${className ? " " + className : ""}`;
  return <textarea className={cls} {...rest} />;
}
