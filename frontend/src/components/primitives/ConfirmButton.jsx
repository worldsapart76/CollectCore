import { useState } from "react";
import Button from "./Button";

export default function ConfirmButton({
  label,
  confirmLabel = "Yes",
  cancelLabel = "No",
  promptText,
  variant = "danger",
  size = "md",
  onConfirm,
  disabled = false,
  busy = false,
  className = "",
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => setArmed(true)}
        className={className}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="cc-confirm">
      {promptText && <span className="cc-confirm__prompt">{promptText}</span>}
      <Button
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => { if (!busy) onConfirm?.(); }}
      >
        {busy ? "…" : confirmLabel}
      </Button>
      <Button
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={() => setArmed(false)}
      >
        {cancelLabel}
      </Button>
    </div>
  );
}
