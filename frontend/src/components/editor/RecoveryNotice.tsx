"use client";

import { formatDateTime } from "@/lib/display-date";

import type { RecoveryCopy } from "@/lib/editor-recovery-store";
import { useState, type AnimationEvent, type TransitionEvent } from "react";
import styles from "./EditorFeedback.module.css";

export default function RecoveryNotice({ copies, error, onRestore, onDiscard, onContinue }: {
  copies: RecoveryCopy[]; error: string;
  onRestore: (copy: RecoveryCopy) => void; onDiscard: () => Promise<void>; onContinue: () => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const [presentation, setPresentation] = useState({ source: copies, visible: copies, leaving: false });
  const [status, setStatus] = useState({ source: error, visible: error, leaving: false });
  if (error !== status.source) {
    const reduceMotion = !error && typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setStatus({ source: error, visible: error || (reduceMotion ? "" : status.visible),
      leaving: !error && Boolean(status.visible) && !reduceMotion });
  }
  if (copies !== presentation.source) {
    const reduceMotion = !copies.length && typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setPresentation({
      source: copies,
      visible: copies.length || reduceMotion ? copies : presentation.visible,
      leaving: !copies.length && Boolean(presentation.visible.length) && !reduceMotion,
    });
  }
  const { visible, leaving } = presentation;

  function finishExit(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows" || copies.length) return;
    setPresentation(current => current.source.length ? current : { ...current, visible: [], leaving: false });
  }

  function finishStatusExit(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows" || error) return;
    setStatus(current => current.source ? current : { ...current, visible: "", leaving: false });
  }

  function finishStatusExitWithoutCollapse(event: AnimationEvent<HTMLParagraphElement>) {
    if (event.target !== event.currentTarget || !event.animationName.includes("recoveryStatusOut") || error) return;
    const slot = event.currentTarget.closest("[data-recovery-status]");
    if (slot?.getAnimations({ subtree: false }).length) return;
    setStatus(current => current.source ? current : { ...current, visible: "", leaving: false });
  }

  async function discard() {
    if (discarding) return;
    setDiscarding(true);
    try { await onDiscard(); } finally { setDiscarding(false); }
  }
  return <>
    <div className={styles.recoveryStatusSlot} data-recovery-status data-visible={Boolean(status.visible) && !status.leaving}
      onTransitionEnd={finishStatusExit}>
      <div className={styles.recoveryStatusClip}>
        {status.visible && <p className={styles.recoveryStatus} role="alert" aria-hidden={status.leaving || undefined}
          onAnimationEnd={finishStatusExitWithoutCollapse}>{status.visible}</p>}
      </div>
    </div>
    {visible.length > 0 && <div className={styles.recoveryShell} data-recovery-shell data-leaving={leaving} onTransitionEnd={finishExit}>
      <div className={styles.recoveryClip}>
        <section className={styles.panel} aria-label="Browser recovery" aria-busy={discarding} aria-hidden={leaving} inert={leaving}>
          <div className={styles.panelHeader}>
            <span className={styles.icon} aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
            </span>
            <div><p className={styles.eyebrow}>BROWSER RECOVERY</p><h2 className={styles.title}>Continue where you left off</h2></div>
            <span className={styles.count}>{visible.length} {visible.length === 1 ? "copy" : "copies"}</span>
          </div>
          <p className={styles.description}>Editing is paused while you choose a version. Restore a browser copy, continue with the current version while keeping the copies, or discard them. Nothing is saved to the server until you choose Save or Publish.</p>
          <ul className={styles.copies}>
            {visible.map((copy, index) => <li className={styles.copy} key={copy.id}>
              <div className={styles.copyDetails}>
                <p className={styles.copyTitle}>{copy.fields.title || "Untitled draft"}</p>
                <time className={styles.timestamp} dateTime={new Date(copy.updatedAt).toISOString()}>{formatDateTime(copy.updatedAt)}</time>
              </div>
              <button type="button" className={`${styles.button} ${styles.secondary}`} disabled={discarding}
                aria-label={`Restore copy ${index + 1}`} onClick={() => onRestore(copy)}>Restore <span aria-hidden="true">↗</span></button>
            </li>)}
          </ul>
          <p className={styles.hint}>Copies may come from another tab. Previously uploaded files may have been removed; check previews before saving.</p>
          <div className={styles.panelFooter}>
            <span className={styles.timestamp}>Stored in this browser · Not saved to server</span>
            <div className={styles.recoveryActions}><button type="button" className={`${styles.button} ${styles.secondary}`} disabled={discarding} onClick={onContinue}>Keep copies and continue</button>
            <button type="button" className={`${styles.button} ${styles.quiet}`} disabled={discarding}
              onClick={() => void discard()}>{discarding ? "Discarding…" : "Discard browser copies"}</button></div>
          </div>
        </section>
      </div>
    </div>}
  </>;
}
