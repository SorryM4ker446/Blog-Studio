"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Criteria = { scope: string; query?: string; categoryId?: string };
const criteriaKey = (value: Criteria) => JSON.stringify([value.scope, value.query ?? "", value.categoryId ?? ""]);

// Retain outgoing content until the requested search criteria have a response.
export function useScopeTransition<T extends Criteria & { error: string; searched?: boolean }>(value: T, scope: string, pending: boolean, criteria?: Omit<Criteria, "scope">, animate = true) {
  const targetKey = criteriaKey({ ...criteria, scope });
  const valueKey = criteriaKey(value);
  const [snapshot, setSnapshot] = useState({ value, key: valueKey, initialEntry: false });
  const displayed = snapshot.value;
  const hasOutgoingResults = displayed.searched !== false;
  const ref = useRef<HTMLElement>(null);
  const entering = useRef(false);
  const changing = snapshot.key !== targetKey;
  if (!changing && valueKey === targetKey && displayed !== value) setSnapshot({ value, key: valueKey, initialEntry: false });

  if (!hasOutgoingResults && changing && !pending && (valueKey === targetKey || value.error)) {
    setSnapshot({ value, key: targetKey, initialEntry: true });
  }

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = !animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
      if (entering.current || snapshot.initialEntry) {
        entering.current = false;
        node.style.opacity = "0";
        node.style.transform = "translateY(8px)";
      }
      fade(1, "none", 280, "cubic-bezier(.22, 1, .36, 1)");
    } else if (pending || (valueKey !== targetKey && !value.error)) {
      fade(1, "none", 180, "ease-out");
    } else {
      fade(0, "translateY(-6px)", 160, "cubic-bezier(.4, 0, 1, 1)", () => {
        entering.current = true;
        setSnapshot({ value: { ...value, scope }, key: targetKey, initialEntry: false });
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
  }, [value, scope, pending, changing, targetKey, valueKey, snapshot.initialEntry, animate]);

  return { displayed, ref, changing };
}
