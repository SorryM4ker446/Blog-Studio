"use client";

import { useModalIsolation } from "@/lib/use-modal-isolation";
import { TrashIcon } from "@/components/Icons";

import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";

interface EditorDeleteDialogProps {
  open: boolean;
  completed?: boolean;
  resourceType: "post" | "file" | "category" | "link";
  busy: boolean;
  blocked: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EditorDeleteDialog({
  open,
  completed = false,
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const [content, setContent] = useState({ resourceType, busy, blocked, error });
  if (open && !present) setPresent(true);
  if (open && (content.resourceType !== resourceType || content.busy !== busy || content.blocked !== blocked || content.error !== error)) {
    setContent({ resourceType, busy, blocked, error });
  }
  const closing = !open;
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (present) previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [present]);
  useModalIsolation(panelRef, present);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!present || !overlay || !panel) return;
    let cancelled = false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof panel.animate !== "function") {
      queueMicrotask(() => { if (!cancelled && !open) setPresent(false); });
      return () => { cancelled = true; };
    }
    const successExit = !open && completed;
    const options = { duration: open ? 240 : successExit ? 300 : 160, easing: open ? "cubic-bezier(.22, 1, .36, 1)" : successExit ? "cubic-bezier(.4, 0, .2, 1)" : "ease-in", fill: "forwards" as const };
    const currentBlur = overlay.style.backdropFilter || getComputedStyle(overlay).backdropFilter || "blur(6px)";
    const backdrop = overlay.animate([
      { opacity: overlay.style.opacity || (open ? "0" : "1"), backdropFilter: currentBlur },
      { opacity: open ? 1 : 0, backdropFilter: successExit ? "blur(0px)" : "blur(6px)" },
    ], options);
    const panelFrames: Keyframe[] = [
      { opacity: panel.style.opacity || (open ? "0" : "1"), transform: panel.style.transform || (open ? "translateY(12px) scale(.98)" : "none") },
      ...(successExit ? [{ opacity: 0, transform: "scale(.985)", offset: .58 }] : []),
      { opacity: open ? 1 : 0, transform: open ? "translateY(0) scale(1)" : successExit ? "scale(.985)" : "translateY(6px) scale(.98)" },
    ];
    const motion = panel.animate(panelFrames, options);
    motion.onfinish = () => { if (!cancelled && !open) setPresent(false); };
    return () => {
      cancelled = true;
      // Preserve the current frame when opening/closing is interrupted.
      overlay.style.opacity = getComputedStyle(overlay).opacity;
      overlay.style.backdropFilter = getComputedStyle(overlay).backdropFilter;
      panel.style.opacity = getComputedStyle(panel).opacity;
      panel.style.transform = getComputedStyle(panel).transform;
      backdrop.cancel(); motion.cancel();
    };
  }, [open, present, completed]);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    const wasBusy = busyRef.current;
    busyRef.current = busy || !open;
    onCancelRef.current = onCancel;
    if (open && busy) panelRef.current?.focus();
    else if (open && wasBusy) panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [busy, onCancel, open]);

  useEffect(() => {
    if (!present) return;
    const previousFocus = previousFocusRef.current;
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
      const restore = previousFocus?.isConnected ? previousFocus : document.querySelector<HTMLElement>(".editor-resource-panel");
      restore?.focus({ preventScroll: true });
    };
  }, [present]);

  if (!present) return null;

  return (
    <div
      ref={overlayRef}
      className="editor-delete-overlay"
      data-state={closing ? "closing" : "open"}
      data-exit={closing ? completed ? "deleted" : "cancelled" : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !closing) onCancel();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="editor-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${content.error ? ` ${errorId}` : ""}`}
        aria-busy={content.busy}
      >
        <div className="editor-delete-content">
          <div className="editor-delete-heading">
            <span className="editor-delete-icon" aria-hidden="true"><TrashIcon size={18} /></span>
            <h2 id={titleId}>Confirm Deletion</h2>
          </div>
          <p id={descriptionId} className="editor-delete-description">
            Are you sure you want to delete this {content.resourceType}?{" "}
            <span className="editor-delete-consequence">
              This action cannot be undone.
              {content.resourceType === "category" && " Posts in this category will automatically become Uncategorized."}
            </span>
          </p>
          {content.error && <p id={errorId} role="alert" aria-live="polite" className="editor-delete-error">{content.error}</p>}
        </div>
        <div className="editor-delete-footer">
          <div className="editor-delete-actions">
            <button type="button" data-autofocus onClick={onCancel} disabled={content.busy || closing} className="editor-delete-cancel">Cancel</button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={content.busy || content.blocked || closing}
              className="editor-delete-confirm"
            >
              {content.busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
