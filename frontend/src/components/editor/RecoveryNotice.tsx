"use client";

import { formatDateTime } from "@/lib/display-date";

import type { RecoveryCopy } from "@/lib/editor-recovery-store";
import { useState } from "react";
import styles from "./EditorFeedback.module.css";

export default function RecoveryNotice({ copies, error, onRestore, onDiscard }: {
  copies: RecoveryCopy[]; error: string;
  onRestore: (copy: RecoveryCopy) => void; onDiscard: () => Promise<void>;
}) {
  const [discarding, setDiscarding] = useState(false);
  async function discard() {
    if (discarding) return;
    setDiscarding(true);
    try { await onDiscard(); } finally { setDiscarding(false); }
  }
  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {copies.length > 0 && <section className={styles.panel} aria-label="Browser recovery" aria-busy={discarding}>
      <div className={styles.panelHeader}>
        <span className={styles.icon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
          </svg>
        </span>
        <div><p className={styles.eyebrow}>BROWSER RECOVERY</p><h2 className={styles.title}>Continue where you left off</h2></div>
        <span className={styles.count}>{copies.length} {copies.length === 1 ? "copy" : "copies"}</span>
      </div>
      <p className={styles.description}>Unsaved browser copies found. Restore one to review your changes, or discard the copies below. Nothing is saved to the server until you choose Save or Publish.</p>
      <ul className={styles.copies}>
        {copies.map((copy, index) => <li className={styles.copy} key={copy.id}>
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
        <button type="button" className={`${styles.button} ${styles.quiet}`} disabled={discarding}
          onClick={() => void discard()}>{discarding ? "Discarding…" : "Discard browser copies"}</button>
      </div>
    </section>}
  </>;
}
