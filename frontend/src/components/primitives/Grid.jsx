export default function Grid({
  cols = 2,
  gap = 4,
  className = "",
  children,
  ...rest
}) {
  const cls = [
    "cc-grid",
    `cc-grid-cols-${cols}`,
    `cc-gap-${gap}`,
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
