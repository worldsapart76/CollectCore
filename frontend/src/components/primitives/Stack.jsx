export default function Stack({
  gap = 4,
  align,
  justify,
  className = "",
  as: Tag = "div",
  children,
  ...rest
}) {
  const cls = [
    "cc-stack",
    `cc-gap-${gap}`,
    align ? `cc-align-${align}` : "",
    justify ? `cc-justify-${justify}` : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
