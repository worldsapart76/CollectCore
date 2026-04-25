export default function CoverThumb({
  src,
  alt = "",
  size = "md",
  className = "",
  fallbackText = "No Cover",
  ...rest
}) {
  const cls = `cc-cover-thumb cc-cover-thumb--${size}${className ? " " + className : ""}`;
  if (!src) {
    return (
      <span className={`${cls} cc-cover-thumb--placeholder`} aria-label={fallbackText}>
        {fallbackText}
      </span>
    );
  }
  return <img src={src} alt={alt} className={cls} loading="lazy" decoding="async" {...rest} />;
}
