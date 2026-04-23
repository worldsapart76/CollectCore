export default function PageContainer({
  density = "default",
  className = "",
  children,
  ...rest
}) {
  const cls = [
    "cc-page",
    density === "dense" ? "cc-page--dense" : "",
    density === "flush" ? "cc-page--flush" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
