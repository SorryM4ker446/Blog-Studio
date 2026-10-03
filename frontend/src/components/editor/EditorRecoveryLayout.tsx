"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

// History retains presentation only. IndexedDB owns copies and recovery choices.
export default function EditorRecoveryLayout({ checking, owner, children }: {
  checking: boolean; owner?: number; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<number[]>([]);

  useLayoutEffect(() => {
    const frame = root.current;
    if (!frame) return;
    const slots = Array.from(frame.querySelectorAll<HTMLElement>("[data-editor-notice]"));
    if (checking) {
      previous.current = slots.map(slot => slot.getBoundingClientRect().height);
      return;
    }
    let active = true;
    let observer: ResizeObserver | undefined;
    const animations: Animation[] = [];
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const returningFromConflict = (previous.current[1] ?? 0) > 0;
      const duration = returningFromConflict ? 440 : 340;
      const easing = returningFromConflict ? "cubic-bezier(.22,.65,.25,1)" : "cubic-bezier(.2,.8,.2,1)";
      slots.forEach((slot, index) => {
        const from = previous.current[index];
        const to = slot.getBoundingClientRect().height;
        if (from === undefined || Math.abs(from - to) < 1) return;
        animations.push(slot.animate([
          { height: `${from}px`, overflow: "hidden" },
          { height: `${to}px`, overflow: "hidden" },
        ], { duration, easing }));
        if (returningFromConflict && index === 0 && from < 1 && to > 0) {
          const panel = slot.querySelector<HTMLElement>('[data-recovery-shell] section');
          if (panel) animations.push(panel.animate([
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ], { duration: 260, delay: 100, easing: "ease-out", fill: "backwards" }));
        }
      });
    }
    previous.current = [];
    const url = location.pathname + location.search;
    const remember = () => {
      if (!owner || location.pathname + location.search !== url) return;
      const heights = ["recovery", "conflict"].map(name =>
        frame.querySelector<HTMLElement>(`[data-editor-notice="${name}"]`)?.getBoundingClientRect().height ?? 0);
      const copies = Array.from(frame.querySelectorAll('[data-recovery-shell]:not([data-leaving="true"]) [data-recovery-copy]')).slice(0, 3).map(row => ({
        title: row.querySelector("[data-recovery-title]")?.textContent ?? "",
        date: row.querySelector("[data-recovery-date]")?.textContent ?? "",
      }));
      const layout = { version: 2, url, owner, width: innerWidth, height: innerHeight, recovery: heights[0], conflict: heights[1], copies };
      try { history.replaceState({ ...history.state, blogEditorLayout: layout }, ""); } catch { /* Layout restoration is optional. */ }
    };
    const settled = () => {
      if (!active) return;
      document.documentElement.removeAttribute("data-initial-editor-loading");
      slots.forEach(slot => { slot.inert = false; });
      frame.dataset.scrollPending = "false";
      observer = new ResizeObserver(remember);
      slots.forEach(slot => observer!.observe(slot));
      window.addEventListener("pagehide", remember);
      remember();
    };
    if (animations.length) {
      // Discovery can insert choices during a height transition. Activate them
      // only after that transition so Restore cannot start a competing collapse.
      slots.forEach(slot => { slot.inert = true; });
      frame.dataset.scrollPending = "true";
      void Promise.all(animations.map(animation => animation.finished)).then(settled, settled);
    } else settled();
    return () => {
      active = false;
      animations.forEach(animation => animation.cancel());
      slots.forEach(slot => { slot.inert = false; });
      observer?.disconnect();
      window.removeEventListener("pagehide", remember);
    };
  }, [checking, owner]);

  return <div ref={root} className="editor-detail-frame" data-editor-owner={owner}
    data-recovery-checking={checking} data-scroll-pending={checking}>{children}</div>;
}
