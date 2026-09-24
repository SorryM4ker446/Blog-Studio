"use client";

import { useEffect, useId } from "react";
import ModalSurface from "./ModalSurface";
import styles from "./ConfirmModal.module.css";

interface ConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "info";
}

export default function ConfirmModal({ isOpen, onConfirm, onCancel, title, message, confirmText = "Confirm", cancelText = "Cancel", type = "info" }: ConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);
  if (!isOpen) return null;
  return <ModalSurface onClose={onCancel} labelledBy={titleId} describedBy={descriptionId} className={styles.panel}>
    {(close, closing) => <>
        <h3 id={titleId} style={{ margin: "0 0 1rem 0", fontSize: "1.25rem", fontWeight: 600, color: "var(--text-primary)" }}>
          {title}
        </h3>
        <p id={descriptionId} style={{ margin: "0 0 2rem 0", color: "var(--text-secondary)", lineHeight: 1.6, fontSize: "0.95rem" }}>
          {message}
        </p>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            disabled={closing}
            data-autofocus
            onClick={close}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "10px",
              border: "1px solid var(--border-color)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={closing}
            onClick={onConfirm}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "10px",
              border: "none",
              background: type === "danger" ? "rgba(242, 139, 130, 0.15)" : "var(--accent-blue)",
              color: type === "danger" ? "var(--accent-red)" : "var(--accent-contrast-text)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "brightness(1)")}
          >
            {confirmText}
          </button>
        </div>

    </>}
  </ModalSurface>;
}
