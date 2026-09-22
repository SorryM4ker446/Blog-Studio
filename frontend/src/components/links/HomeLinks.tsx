"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getHomepageLinks, type HomepageLink } from "@/lib/links";
import { getApiErrorMessage } from "@/lib/api-client";
import LinkCard from "./LinkCard";
import styles from "./Links.module.css";

export default function HomeLinks({ initialLinks, initialError = "" }: { initialLinks: HomepageLink[]; initialError?: string }) {
  const [links, setLinks] = useState(initialLinks);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const [overflow, setOverflow] = useState(false);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [links]);
  async function retry() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    try { const data = await getHomepageLinks(controller.signal); if (!controller.signal.aborted) { setLinks(data); setError(""); } }
    catch (err) { if (!controller.signal.aborted) setError(getApiErrorMessage(err)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function slide(direction: number) {
    const node = track.current;
    if (!node) return;
    const gap = parseFloat(getComputedStyle(node).columnGap) || 16;
    node.scrollBy({ left: direction * (node.clientWidth + gap), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  function finishDrag() {
    const node = track.current;
    const current = drag.current;
    if (!node || !current) return;
    drag.current = null;
    suppressClick.current = current.moved;
    if (!current.moved) return;
    const card = node.firstElementChild;
    const stride = (card?.getBoundingClientRect().width ?? node.clientWidth) + (parseFloat(getComputedStyle(node).columnGap) || 0);
    const left = Math.round(node.scrollLeft / stride) * stride;
    delete node.dataset.dragging;
    if (node.hasPointerCapture(current.id)) node.releasePointerCapture(current.id);
    node.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  if (error) return <div className={styles.loadError} role="alert"><span>{error}</span><button type="button" disabled={loading} onClick={() => void retry()}>{loading ? "Loading…" : "Try again"}</button></div>;
  if (!links.length) return null;
  return <section className={styles.carousel} aria-label="Featured links">
    <div ref={track} className={styles.track} data-overflow={overflow} tabIndex={0}
      onPointerDown={event => {
        suppressClick.current = false;
        if (event.pointerType !== "mouse" || event.button !== 0 || !overflow) return;
        drag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const delta = event.clientX - current.x;
        if (!current.moved && Math.abs(delta) < 6) return;
        if (!current.moved) {
          current.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.dragging = "true";
        }
        event.preventDefault();
        event.currentTarget.scrollLeft = current.left - delta;
      }}
      onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
      onPointerLeave={() => { if (!drag.current?.moved) drag.current = null; }}
      onClickCapture={event => {
        if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
        suppressClick.current = false;
      }} aria-label="Browse links" onKeyDown={event => {
      if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home" || event.key === "End") event.currentTarget.scrollTo({ left: event.key === "Home" ? 0 : event.currentTarget.scrollWidth, behavior: "instant" });
      else slide(event.key === "ArrowLeft" ? -1 : 1);
    }}>
      {links.map(link => <LinkCard key={link.id} link={link} />)}
    </div>
  </section>;
}
