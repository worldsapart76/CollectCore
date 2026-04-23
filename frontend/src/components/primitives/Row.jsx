export default function Row({
  gap = 4,
  align = "center",
  justify,
  wrap = false,
  className = "",
  as: Tag = "div",
  children,
  ...rest
}) {
  const cls = [
    "cc-row",
    `cc-gap-${gap}`,
    align ? `cc-align-${align}` : "",
    justify ? `cc-justify-${justify}` : "",
    wrap ? "cc-wrap" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
