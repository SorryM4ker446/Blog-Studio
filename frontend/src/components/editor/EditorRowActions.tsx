"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, DownloadIcon, EditIcon, TrashIcon } from "@/components/Icons";
import styles from "./EditorRowActions.module.css";

export default function EditorRowActions({ label, open, opening = false, unavailable = false, onToggle, onClose, onEdit, onDelete, downloadUrl }: {
  label: string; open: boolean; opening?: boolean; unavailable?: boolean; onToggle: () => void; onClose: () => void;
  onEdit: () => void; onDelete: () => void; downloadUrl?: string;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [openUp, setOpenUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) onClose();
    }
    function onFocusIn(event: FocusEvent) {
      if (!container.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        trigger.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  function run(action: () => void) {
    onClose();
    trigger.current?.focus({ preventScroll: true });
    action();
  }

  return <div className={styles.actions} ref={container}>
    <button type="button" ref={trigger} className={styles.more} aria-label={`More actions for ${label}`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-busy={opening}
      disabled={opening || unavailable} onClick={() => {
        if (!open) setOpenUp(window.innerHeight - (container.current?.closest("article")?.getBoundingClientRect().bottom ?? 0) < 140);
        onToggle();
      }}
    >More {opening ? <svg className="editor-opening-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" opacity=".2" /><path d="M12 3a9 9 0 0 1 9 9" /></svg> : <span className={styles.chevron}><ChevronDownIcon size={14} /></span>}</button>
    <div id={id} className={`${styles.menu} ${openUp ? styles.menuUp : ""} ${open ? styles.menuOpen : ""}`} role="group" aria-label={`Actions for ${label}`} aria-hidden={!open} inert={!open}>
      <button type="button" className={styles.menuItem} onClick={() => run(onEdit)}><EditIcon size={15} /> Edit</button>
      {downloadUrl && <a className={styles.menuItem} href={downloadUrl} download onClick={() => { onClose(); trigger.current?.focus({ preventScroll: true }); }}><DownloadIcon size={15} /> Download</a>}
      <button type="button" className={`${styles.menuItem} ${styles.danger}`} onClick={() => run(onDelete)}><TrashIcon size={15} /> Delete</button>
    </div>
  </div>;
}
