export default function Card({
  flush = false,
  surface = false,
  className = "",
  children,
  ...rest
}) {
  const cls = [
    "cc-card",
    flush ? "cc-card--flush" : "",
    surface ? "cc-card--surface" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
