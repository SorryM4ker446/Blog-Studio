"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Pagination from "./Pagination";
import styles from "./PaginatedResults.module.css";

interface Props {
  children: ReactNode;
  page: number;
  totalPages: number;
  resultKey: string;
  pending: boolean;
  edgeArrows?: boolean;
  stablePageHeight?: boolean;
  transitionGroup?: string;
  animateChanges?: boolean;
  onPageChange: (page: number) => void;
}

export default function PaginatedResults({ children, page, totalPages, resultKey, pending, edgeArrows = false, stablePageHeight = false, transitionGroup = "", animateChanges = true, onPageChange }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState({ children, page, totalPages, key: resultKey, group: transitionGroup });
  const changing = animateChanges && shown.group === transitionGroup && shown.key !== resultKey;
  if (shown.group !== transitionGroup || (!changing && (shown.key !== resultKey || shown.children !== children || shown.totalPages !== totalPages))) {
    setShown({ children, page, totalPages, key: resultKey, group: transitionGroup });
  }
  const entry = useRef<{ direction: number; height: number } | null>(null);
  const previousGroup = useRef(transitionGroup);
  const incoming = useRef(shown);
  const visual = useRef<{ opacity: string; transform: string } | null>(null);
  const direction = Math.sign(page - shown.page);
  useLayoutEffect(() => { incoming.current = { children, page, totalPages, key: resultKey, group: transitionGroup }; });

  useLayoutEffect(() => {
    const frame = viewport.current!;
    const body = content.current!;
    if (previousGroup.current !== transitionGroup) entry.current = null;
    previousGroup.current = transitionGroup;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animated = animateChanges && typeof body.animate === "function" && !reduced;
    const animations: Animation[] = [];
    let cancelled = false;
    if (changing) {
      const height = frame.getBoundingClientRect().height;
      const commit = () => {
        if (cancelled) return;
        entry.current = animated ? { direction, height } : null;
        setShown(incoming.current);
      };
      if (animated) {
        const animation = body.animate([
          visual.current || { opacity: getComputedStyle(body).opacity, transform: getComputedStyle(body).transform },
          { opacity: 0, transform: `translateX(${-direction * 8}px)` },
        ], { duration: 140, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
        animations.push(animation);
        animation.onfinish = commit;
      } else commit();
    } else if (entry.current) {
      const { direction, height } = entry.current;
      entry.current = null;
      if (animated) {
        animations.push(body.animate([
          { opacity: 0, transform: `translateX(${direction * 14}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)" }));
        if (!stablePageHeight && Math.abs(height - body.getBoundingClientRect().height) > 1) {
          animations.push(frame.animate([{ height: `${height}px` }, { height: `${body.getBoundingClientRect().height}px` }],
            { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)" }));
        }
      }
    }
    return () => {
      cancelled = true;
      visual.current = { opacity: getComputedStyle(body).opacity, transform: getComputedStyle(body).transform };
      animations.forEach(animation => animation.cancel());
    };
  }, [resultKey, direction, changing, stablePageHeight, transitionGroup, animateChanges]);

  return (
    <div className={styles.frame}>
      <div ref={viewport} className={styles.viewport} data-list-layout={stablePageHeight ? "editor" : undefined} inert={changing}>
        <div ref={content} data-result-page={shown.page}>{shown.children}</div>
      </div>
      <Pagination currentPage={shown.page} totalPages={shown.totalPages} pending={pending || changing} edgeArrows={edgeArrows} onPageChange={onPageChange} />
    </div>
  );
}
