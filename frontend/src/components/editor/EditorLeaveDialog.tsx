"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { answerNavigationPrompt, getNavigationPrompt, subscribeNavigationPrompt } from "@/lib/editor-navigation";
import styles from "./EditorFeedback.module.css";

const serverSnapshot = () => null;

export default function EditorLeaveDialog() {
  const prompt = useSyncExternalStore(subscribeNavigationPrompt, getNavigationPrompt, serverSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  const open = Boolean(prompt);

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

  if (!prompt) return null;
  return createPortal(
    <dialog ref={dialogRef} tabIndex={-1} className={styles.dialog} role="alertdialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={prompt.busy}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={event => { event.preventDefault(); void answerNavigationPrompt(false); }}>
      <div className={styles.dialogContent}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
          </svg>
        </span>
        <p className={styles.eyebrow}>UNSAVED CHANGES</p>
        <h2 id={titleId} className={styles.title}>Leave this editor?</h2>
        <p id={descriptionId} className={styles.description}>Your changes haven’t been saved to the server. A browser recovery copy may be available when you return.</p>
        <div className={styles.hint}>Choose Stay in editor to keep working or save your changes first.</div>
        {prompt.error && <p className={styles.error} role="alert">{prompt.error}</p>}
        <div className={styles.dialogActions}>
          <button ref={stayRef} type="button" className={`${styles.button} ${styles.secondary}`}
            onClick={() => void answerNavigationPrompt(false)}>Stay in editor</button>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={prompt.busy}
            onClick={() => void answerNavigationPrompt(true)}>{prompt.busy ? "Leaving…" : "Leave editor"}</button>
        </div>
      </div>
    </dialog>, document.body,
  );
}
