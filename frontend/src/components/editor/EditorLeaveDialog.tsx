"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type AnimationEvent } from "react";
import { createPortal } from "react-dom";
import { answerNavigationPrompt, getNavigationPrompt, subscribeNavigationPrompt } from "@/lib/editor-navigation";
import styles from "./EditorFeedback.module.css";

const serverSnapshot = () => null;

export default function EditorLeaveDialog() {
  const prompt = useSyncExternalStore(subscribeNavigationPrompt, getNavigationPrompt, serverSnapshot);
  const [presentation, setPresentation] = useState({ input: prompt, visible: prompt, closing: false });
  if (prompt !== presentation.input) {
    const reduceMotion = !prompt && typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPresentation({ input: prompt, visible: prompt ?? (reduceMotion ? null : presentation.visible),
      closing: !prompt && Boolean(presentation.visible) && !reduceMotion });
  }
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const finishClosing = useRef<(() => void) | null>(null);
  const titleId = useId(), descriptionId = useId();
  const open = Boolean(presentation.visible);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog.showModal();
    stayRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => () => { finishClosing.current?.(); finishClosing.current = null; }, []);

  function closeAfterAnimation() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    setPresentation(current => ({ ...current, closing: true }));
    return new Promise<void>(resolve => { finishClosing.current = resolve; });
  }

  function onExitAnimationEnd(event: AnimationEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget || !presentation.closing || !event.animationName.includes("editorLeaveDialogOut")) return;
    setPresentation(current => ({ ...current, visible: null, closing: false }));
    finishClosing.current?.();
    finishClosing.current = null;
  }

  if (!presentation.visible) return null;
  const displayed = presentation.visible;
  return createPortal(
    <dialog ref={dialogRef} tabIndex={-1} className={styles.dialog} role="alertdialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={displayed.busy}
      data-closing={presentation.closing} onAnimationEnd={onExitAnimationEnd}
      onKeyDown={event => {
        if (presentation.closing) { event.preventDefault(); return; }
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={event => { event.preventDefault(); if (!presentation.closing) void answerNavigationPrompt(false); }}>
      <div className={styles.dialogContent}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
          </svg>
        </span>
        <p className={styles.eyebrow}>UNSAVED CHANGES</p>
        <h2 id={titleId} className={styles.title}>Leave this editor?</h2>
        <p id={descriptionId} className={styles.description}>Your changes haven’t been saved to the server. A browser recovery copy may be available when you return.</p>
        {displayed.error ? <p className={styles.dialogWarning} role="alert">
          {displayed.error}
        </p> : <div className={styles.hint}>Choose Stay in editor to keep working or save your changes first.</div>}
        <div className={`${styles.dialogActions} ${displayed.error ? styles.dialogActionsWithWarning : ""}`}>
          <button ref={stayRef} type="button" className={`${styles.button} ${styles.secondary}`} disabled={presentation.closing}
            onClick={() => void answerNavigationPrompt(false)}>Stay in editor</button>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={displayed.busy || presentation.closing}
            onClick={() => void answerNavigationPrompt(true, closeAfterAnimation)}>{displayed.busy ? "Leaving…" : displayed.error ? "Leave anyway" : "Leave editor"}</button>
        </div>
      </div>
    </dialog>, document.body,
  );
}
