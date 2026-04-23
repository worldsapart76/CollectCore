import { useEffect } from "react";

export default function Toast({
  tone = "ok",
  message,
  onDismiss,
  autoDismissMs,
  children,
}) {
  useEffect(() => {
    if (!autoDismissMs || !onDismiss) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  return (
    <div className={`cc-toast cc-toast--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{children ?? message}</span>
      {onDismiss && (
        <button
          type="button"
          className="cc-toast__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >✕</button>
      )}
    </div>
  );
}
