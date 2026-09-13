"use client";

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const historyKey = "blogSidebarSelection";
const subscribe = () => () => {};
const isSelection = (value: unknown): value is string => typeof value === "string" && /^\/(?:posts(?:\?category=\d+)?|editor|search|drive|login|settings)?$/.test(value);

export function useSidebarSelection() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const pathname = usePathname();
  const search = useSearchParams();
  const location = `${pathname}?${search.toString()}`;
  const category = pathname === "/posts" ? search.get("category") : null;
  const current = category ? `/posts?category=${category}` : pathname;
  const detail = pathname.startsWith("/posts/");
  const [state, setState] = useState({ location, selection: detail ? "/posts" : current });
  const saved = hydrated ? window.history.state?.[historyKey] : undefined;
  if (state.location !== location || (detail && isSelection(saved) && saved !== state.selection)) {
    setState({ location, selection: detail ? (isSelection(saved) ? saved : state.selection) : current });
  }
  useLayoutEffect(() => {
    if (!hydrated) return;
    window.history.replaceState({ ...window.history.state, [historyKey]: state.selection }, "");
    document.documentElement.removeAttribute("data-initial-sidebar");
  }, [hydrated, location, state.selection]);
  return state.selection;
}
