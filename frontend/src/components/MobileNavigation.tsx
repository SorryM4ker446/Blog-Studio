"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarContent, SidebarFooter } from "./Providers";

export default function MobileNavigation() {
  const pathname = usePathname();
  const params = useSearchParams();
  const location = `${pathname}?${params.toString()}`;
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = openedAt !== null && openedAt === location;

  if (openedAt !== null && openedAt !== location) setOpenedAt(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        setOpenedAt(null);
        requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
      }
    };
    const media = window.matchMedia("(max-width: 768px)");
    media.addEventListener("change", closeOnDesktop);
    return () => {
      dialog.close();
      media.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);

  function close() {
    setOpenedAt(null);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return <>
    <button ref={triggerRef} className="mobile-menu-toggle" type="button" aria-label="Open navigation"
      aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-navigation"
      onClick={() => { setHasOpened(true); setOpenedAt(location); }}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <dialog ref={dialogRef} id="mobile-navigation" className="mobile-navigation" aria-label="Site navigation" aria-hidden={!open}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
          .filter(element => !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      {hasOpened && <div className="mobile-navigation-panel" inert={!open}>
        <div className="sidebar-header"><span className="sidebar-logo-text">Blog Studio</span>
          <button type="button" className="editor-icon-button" aria-label="Close navigation" onClick={close}>×</button>
        </div>
        <SidebarContent expanded />
        <SidebarFooter expanded />
      </div>}
    </dialog>
  </>;
}
