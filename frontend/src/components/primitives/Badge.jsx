const OWNERSHIP_TONE_BY_INITIAL = {
  O: "owned",
  W: "wanted",
  T: "trade",
  B: "borrowed",
};

export default function Badge({
  tone = "neutral",
  className = "",
  children,
  ...rest
}) {
  const isOwnership = ["owned", "wanted", "trade", "borrowed"].includes(tone);
  const cls = [
    "cc-badge",
    isOwnership ? "cc-badge--ownership" : "",
    `cc-badge--${tone}`,
    className,
  ].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}

export function ownershipToneFromInitial(initial) {
  return OWNERSHIP_TONE_BY_INITIAL[initial] ?? "neutral";
}
