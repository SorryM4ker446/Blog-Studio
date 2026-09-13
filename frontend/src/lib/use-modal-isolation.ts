"use client";

import { useEffect, type RefObject } from "react";

/** Isolate an inline dialog without making its own ancestors inert. */
export function useModalIsolation(panel: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open || !panel.current) return;
    const previous = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = panel.current;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          previous.set(sibling, sibling.hasAttribute("inert"));
          sibling.setAttribute("inert", "");
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    return () => previous.forEach((inert, element) => { element.toggleAttribute("inert", inert); });
  }, [open, panel]);
}
