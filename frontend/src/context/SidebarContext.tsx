"use client";

import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getCategories, type Category } from "@/lib/api";
import type { SidebarCategory } from "@/lib/app-shell-state";
import { writePreference } from "@/lib/preference-cookies";
import { useSidebarSelection } from "@/lib/use-sidebar-selection";

interface SidebarContextType {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  categories: SidebarCategory[];
  initialPostsExpanded: boolean;
  initialShowAllCategories: boolean;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);
export const SidebarSelectionContext = createContext<string | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
}

export function SidebarProvider({ children, initialCollapsed = false, initialPostsExpanded = false,
  initialShowAllCategories = false, initialCategories = [], initialCategoriesResolved = false,
}: { children: ReactNode; initialCollapsed?: boolean; initialPostsExpanded?: boolean;
  initialShowAllCategories?: boolean; initialCategories?: SidebarCategory[]; initialCategoriesResolved?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [categories, setCategories] = useState<SidebarCategory[]>(initialCategories);
  const categoryRefreshRef = useRef({ id: 0 });
  const selection = useSidebarSelection();

  // Keep the server-rendered selector and the hydrated sidebar in the same paint.
  useLayoutEffect(() => {
    if (isCollapsed) document.documentElement.setAttribute("data-sidebar-state", "collapsed");
    else document.documentElement.removeAttribute("data-sidebar-state");
  }, [isCollapsed]);

  const toggleSidebar = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    writePreference("sidebar_collapsed", next ? "true" : "false");
  };

  const refreshCategories = useCallback(async () => {
    const requestId = ++categoryRefreshRef.current.id;
    try {
      const cats: Category[] = await getCategories({ fresh: true });
      if (requestId !== categoryRefreshRef.current.id) return;
      const nextCategories = cats
        .filter((c) => (c.post_count || 0) > 0)
        .sort((a, b) => (b.post_count || 0) - (a.post_count || 0))
        .map((category) => ({
          id: category.id,
          name: category.name,
          post_count: category.post_count || 0,
        }));
      setCategories((current) => {
        if (current.length === nextCategories.length && current.every((category, index) => {
          const next = nextCategories[index];
          return category.id === next.id
            && category.name === next.name
            && category.post_count === next.post_count;
        })) {
          return current;
        }
        return nextCategories;
      });
    } catch {
      // Keep the last successful category list when the public API is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    const refreshState = categoryRefreshRef.current;
    const frame = initialCategoriesResolved ? 0 : window.requestAnimationFrame(() => {
      void refreshCategories();
    });
    window.addEventListener("blog:refresh-sidebar", refreshCategories);
    return () => {
      refreshState.id++;
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("blog:refresh-sidebar", refreshCategories);
    };
  }, [initialCategoriesResolved, refreshCategories]);

  return <SidebarContext.Provider value={{ isCollapsed, toggleSidebar, categories, initialPostsExpanded, initialShowAllCategories }}>
    <SidebarSelectionContext.Provider value={selection}>{children}</SidebarSelectionContext.Provider>
  </SidebarContext.Provider>;
}
