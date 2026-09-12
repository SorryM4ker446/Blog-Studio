"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Keep the outgoing results until the current scope's response is ready.
export function useScopeTransition<T extends { scope: string; error: string }>(value: T, scope: string, pending: boolean) {
  const [displayed, setDisplayed] = useState(value);
  const ref = useRef<HTMLElement>(null);
  const entering = useRef(false);
  const changing = displayed.scope !== scope;
  if (!changing && value.scope === scope && displayed !== value) setDisplayed(value);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let animation: Animation | undefined;
    let cancelled = false;
    function fade(opacity: number, transform: string, duration: number, easing: string, done?: () => void) {
      const from = getComputedStyle(node!).opacity || "1";
      const fromTransform = getComputedStyle(node!).transform || "none";
      node!.style.opacity = String(opacity);
      node!.style.transform = transform;
      if (reduced || typeof node!.animate !== "function" || (Number(from) === opacity && fromTransform === transform)) {
        done?.();
        return;
      }
      animation = node!.animate([{ opacity: from, transform: fromTransform }, { opacity, transform }], { duration, easing });
      animation.onfinish = () => { if (!cancelled) done?.(); };
    }
    if (!changing) {
      if (entering.current) {
        entering.current = false;
        node.style.opacity = "0";
        node.style.transform = "translateY(8px)";
      }
      fade(1, "none", 280, "cubic-bezier(.22, 1, .36, 1)");
    } else if (pending || (value.scope !== scope && !value.error)) {
      fade(1, "none", 180, "ease-out");
    } else {
      fade(0, "translateY(-6px)", 160, "cubic-bezier(.4, 0, 1, 1)", () => {
        entering.current = true;
        setDisplayed({ ...value, scope });
      });
    }
    return () => {
      cancelled = true;
      if (animation) {
        node.style.opacity = getComputedStyle(node).opacity;
        node.style.transform = getComputedStyle(node).transform;
        animation.cancel();
      }
    };
  }, [value, scope, pending, changing]);

  return { displayed, ref, changing };
}
