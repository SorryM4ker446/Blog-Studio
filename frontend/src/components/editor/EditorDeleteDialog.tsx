"use client";

import { useEffect, useId, useRef } from "react";

interface EditorDeleteDialogProps {
  open: boolean;
  resourceType: "post" | "file" | "category";
  busy: boolean;
  blocked: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EditorDeleteDialog({
  open,
  resourceType,
  busy,
  blocked,
  error,
  onConfirm,
  onCancel,
}: EditorDeleteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy;
    onCancelRef.current = onCancel;
    if (open && busy) panelRef.current?.focus();
    else if (open && wasBusy) panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [busy, onCancel, open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === panelRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="editor-delete-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="editor-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
        aria-busy={busy}
      >
        <div className="editor-delete-icon" aria-hidden="true">🗑️</div>
        <h2 id={titleId}>Confirm Deletion</h2>
        <p id={descriptionId}>
          Are you sure you want to delete this {resourceType}? This action cannot be undone.
          {resourceType === "category" && " Posts in this category will automatically become Uncategorized."}
        </p>
        <div className="editor-delete-actions">
          <button type="button" data-autofocus onClick={onCancel} disabled={busy} className="editor-delete-cancel">Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || blocked}
            className="editor-delete-confirm"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="editor-delete-error"
          style={{ visibility: error ? "visible" : "hidden" }}
        >
          {error || "No deletion error"}
        </p>
      </div>
    </div>
  );
}
