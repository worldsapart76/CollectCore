import { useEffect } from "react";

export default function Modal({
  isOpen,
  onClose,
  title,
  size = "md",
  footer,
  footerJustify = "end",
  showClose = true,
  className = "",
  children,
}) {
  useEffect(() => {
    if (!isOpen || !onClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const modalCls = `cc-modal cc-modal--${size}${className ? " " + className : ""}`;
  const footerCls = `cc-modal__footer${footerJustify === "between" ? " cc-modal__footer--between" : ""}`;

  return (
    <div
      className="cc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div className={modalCls} role="dialog" aria-modal="true">
        {(title || showClose) && (
          <div className="cc-modal__header">
            {title ? <h2 className="cc-modal__title">{title}</h2> : <span />}
            {showClose && onClose && (
              <button
                type="button"
                className="cc-modal__close"
                onClick={onClose}
                aria-label="Close"
              >✕</button>
            )}
          </div>
        )}
        <div className="cc-modal__body">{children}</div>
        {footer && <div className={footerCls}>{footer}</div>}
      </div>
    </div>
  );
}
