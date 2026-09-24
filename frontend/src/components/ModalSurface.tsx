"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalIsolation } from "@/lib/use-modal-isolation";
import styles from "./ModalSurface.module.css";

interface ModalSurfaceProps {
  onClose: () => void;
  busy?: boolean;
  closeRequested?: boolean;
  labelledBy: string;
  describedBy?: string;
  className: string;
  children: (close: () => void, closing: boolean) => ReactNode;
}

/** Keep the dialog and background isolation alive until both surfaces fade out. */
export default function ModalSurface({ onClose, busy = false, closeRequested = false, labelledBy, describedBy, className, children }: ModalSurfaceProps) {
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const backdropPressed = useRef(false);
  const [dismissed, setClosing] = useState(false);
  const closing = dismissed || closeRequested;
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  useModalIsolation(panel, true);
  useLayoutEffect(() => {
    if (busy || closing) panel.current?.focus({ preventScroll: true });
  }, [busy, closing]);

  useLayoutEffect(() => {
    const surface = panel.current!;
    const backdrop = overlay.current!;
    let cancelled = false;
    const finish = () => {
      if (!cancelled && closing && !closed.current) {
        closed.current = true;
        onCloseRef.current();
      }
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof surface.animate !== "function") {
      queueMicrotask(finish);
      return () => { cancelled = true; };
    }
    const options = { duration: closing ? 180 : 260, easing: closing ? "cubic-bezier(.4, 0, 1, 1)" : "cubic-bezier(.16, 1, .3, 1)", fill: "forwards" as const };
    const fade = backdrop.animate([
      { opacity: backdrop.style.opacity || (closing ? "1" : "0") }, { opacity: closing ? 0 : 1 },
    ], options);
    const motion = surface.animate([
      { opacity: surface.style.opacity || (closing ? "1" : "0"), transform: surface.style.transform || (closing ? "none" : "translateY(14px) scale(.98)") },
      { opacity: closing ? 0 : 1, transform: closing ? "translateY(6px) scale(.99)" : "translateY(0) scale(1)" },
    ], options);
    motion.onfinish = finish;
    return () => {
      cancelled = true;
      backdrop.style.opacity = getComputedStyle(backdrop).opacity;
      surface.style.opacity = getComputedStyle(surface).opacity;
      surface.style.transform = getComputedStyle(surface).transform;
      fade.cancel(); motion.cancel();
    };
  }, [closing]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      (panel.current?.querySelector<HTMLElement>("[data-autofocus]") || panel.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const target = previousFocus.current?.isConnected ? previousFocus.current : document.querySelector<HTMLElement>(".editor-resource-panel");
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy && !closing) setClosing(true);
      }
      if (event.key !== "Tab") return;
      const elements = closing ? [] : Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      const first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.current?.focus(); }
      else if (document.activeElement === panel.current || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [busy, closing]);

  return createPortal(<div ref={overlay} className={styles.overlay} data-modal-overlay data-state={closing ? "closing" : "open"}
    onPointerDown={event => { backdropPressed.current = event.target === event.currentTarget && event.button === 0; }}
    onPointerUp={event => { backdropPressed.current = backdropPressed.current && event.target === event.currentTarget; }}
    onPointerCancel={() => { backdropPressed.current = false; }}
    onClick={event => {
      if (backdropPressed.current && event.target === event.currentTarget && !busy && !closing) setClosing(true);
      backdropPressed.current = false;
    }}>
    <div ref={panel} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy} tabIndex={-1} data-modal-panel>
      <div inert={closing || undefined}>{children(() => setClosing(true), closing)}</div>
    </div>
  </div>, document.body);
}
