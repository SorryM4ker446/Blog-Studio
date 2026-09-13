"use client";

import { ReactNode, type ComponentProps, useEffect, useLayoutEffect, useId, useState, useRef, useCallback, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, type Theme } from "@/context/ThemeContext";
import { getCategories, Category } from "@/lib/api";
import type { InitialAppShellState, SidebarCategory } from "@/lib/app-shell-state";
import { writePreference } from "@/lib/preference-cookies";
import EditorLeaveDialog from "./editor/EditorLeaveDialog";
import {
  GridIcon,
  ListIcon,
  CloudIcon,
  EditIcon,
  SearchIcon,
  SettingsIcon,
  LoginIcon,
  ChevronDownIcon
} from "./Icons";

// ─── Sidebar Context ──────────────────────────────────────────────────────────
interface SidebarContextType {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  initialCategories: SidebarCategory[];
  categoriesResolved: boolean;
  initialPostsExpanded: boolean;
  initialShowAllCategories: boolean;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
}

// ─── Root Provider ────────────────────────────────────────────────────────────
export function Providers({
  children,
  initialSidebarCollapsed = false,
  initialSidebarPostsExpanded = false,
  initialSidebarShowAllCategories = false,
  initialTheme = "dark",
  initialAppShellState,
}: {
  children: ReactNode;
  initialSidebarCollapsed?: boolean;
  initialSidebarPostsExpanded?: boolean;
  initialSidebarShowAllCategories?: boolean;
  initialTheme?: Theme;
  initialAppShellState?: InitialAppShellState;
}) {
  const [isCollapsed, setIsCollapsed] = useState(initialSidebarCollapsed);

  // Keep the server-rendered selector and the hydrated sidebar in the same paint.
  useLayoutEffect(() => {
    if (isCollapsed) {
      document.documentElement.setAttribute("data-sidebar-state", "collapsed");
    } else {
      document.documentElement.removeAttribute("data-sidebar-state");
    }
  }, [isCollapsed]);

  const toggleSidebar = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    writePreference("sidebar_collapsed", next ? "true" : "false");
  };

  return (
    <ThemeProvider initialTheme={initialTheme}>
      <AuthProvider initialState={initialAppShellState}>
        <SidebarContext.Provider value={{
          isCollapsed,
          toggleSidebar,
          initialCategories: initialAppShellState?.categories || [],
          categoriesResolved: initialAppShellState?.categoriesResolved || false,
          initialPostsExpanded: initialSidebarPostsExpanded,
          initialShowAllCategories: initialSidebarShowAllCategories,
        }}>
          {children}
          <EditorLeaveDialog />
        </SidebarContext.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}

// ─── Sidebar Nav ──────────────────────────────────────────────────────────────
function SidebarPageLink({ href, className = "", ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return <Link {...props} href={href} className={`${className}${active && href !== "/" ? " active" : ""}`} aria-current={active ? "page" : undefined} />;
}

export function SidebarContent({ expanded = false }: { expanded?: boolean } = {}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    isCollapsed: desktopCollapsed,
    initialCategories,
    categoriesResolved,
    initialPostsExpanded,
    initialShowAllCategories,
  } = useSidebar();
  const isCollapsed = !expanded && desktopCollapsed;
  const [categories, setCategories] = useState<SidebarCategory[]>(initialCategories);
  const selectedCategoryId = pathname === "/posts" ? searchParams.get("category") : null;
  const isAllPostsActive = (pathname === "/posts" && !selectedCategoryId) || pathname.startsWith("/posts/");
  const [isPostsExpanded, setIsPostsExpanded] = useState(initialPostsExpanded || Boolean(selectedCategoryId));
  const [showAllCategories, setShowAllCategories] = useState(initialShowAllCategories);
  const categoryRefreshRef = useRef({ id: 0 });
  const extraCategoriesId = useId();

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
    const frame = categoriesResolved ? 0 : window.requestAnimationFrame(() => {
      void refreshCategories();
    });
    window.addEventListener("blog:refresh-sidebar", refreshCategories);
    return () => {
      refreshState.id++;
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("blog:refresh-sidebar", refreshCategories);
    };
  }, [categoriesResolved, refreshCategories]);

  const renderCategory = (cat: SidebarCategory) => {
    const isActive = selectedCategoryId === cat.id.toString();
    return (
      <Link
        key={cat.id}
        href={`/posts?category=${cat.id}`}
        className={`sidebar-category-link${isActive ? " active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="sidebar-category-name">{cat.name}</span>
        <span className="sidebar-category-count">{cat.post_count}</span>
      </Link>
    );
  };

  return (
    <nav className="nav-menu" aria-label="Primary navigation">
      {/* Posts Playground */}
      <SidebarPageLink href="/" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
        <GridIcon className="nav-icon" style={{ color: "var(--accent-yellow)" }} />
        <span className="nav-item-label">Posts Playground</span>
      </SidebarPageLink>

      <div className="nav-group-title">Features</div>

      {/* ── All Posts row ──────────────────────────────────────────────────── */}
      <div className={`nav-posts-row${isAllPostsActive ? " active" : ""}`}>
        <Link href="/posts" className="nav-posts-link" aria-label="All Posts" data-tooltip={isCollapsed ? "All Posts" : undefined} aria-current={isAllPostsActive ? "page" : undefined}>
          <ListIcon className="nav-icon active-icon-blue" />
          <span className="nav-item-label">All Posts</span>
        </Link>
        <button
          type="button"
          className="nav-posts-chevron"
          inert={isCollapsed}
          aria-hidden={isCollapsed}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const next = !isPostsExpanded;
            setIsPostsExpanded(next);
            writePreference("sidebar_posts_expanded", next ? "true" : "false");
          }}
          aria-label="Toggle categories"
          aria-expanded={isPostsExpanded}
        >
          <ChevronDownIcon
            className="nav-posts-chevron-icon"
            size={14}
          />
        </button>
      </div>

      {/* Categories sub-menu */}
      {categories.length > 0 && (
        <div
          className={`sidebar-categories${!isCollapsed && isPostsExpanded ? " expanded" : ""}`}
          aria-hidden={isCollapsed || !isPostsExpanded}
          inert={isCollapsed || !isPostsExpanded}
        >
          <div className="sidebar-categories-inner">
            {categories.slice(0, 3).map(renderCategory)}
            {categories.length > 3 && <div id={extraCategoriesId}
              className="sidebar-categories-extra" data-expanded={showAllCategories}
              inert={!showAllCategories} aria-hidden={!showAllCategories}>
              <div className="sidebar-categories-extra-content">{categories.slice(3).map(renderCategory)}</div>
            </div>}

            {categories.length > 3 && (
              <div className="sidebar-categories-toggle" data-expanded={showAllCategories}>
              <button
                type="button"
                className="sidebar-categories-more"
                aria-expanded={showAllCategories}
                aria-controls={extraCategoriesId}
                onClick={() => {
                  const next = !showAllCategories;
                  setShowAllCategories(next);
                  writePreference("sidebar_categories_all", next ? "true" : "false");
                }}
              >
                <span className="sidebar-categories-more-label">{showAllCategories ? "Less" : "More"}</span>
                <span className="sidebar-categories-more-icon" aria-hidden="true"><ChevronDownIcon size={14} /></span>
              </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cloud Drive */}
      <SidebarPageLink href="/drive" inert={isCollapsed} aria-hidden={isCollapsed} className={`nav-item hide-on-collapse nav-cloud-drive${!isCollapsed && isPostsExpanded ? " categories-expanded" : ""}`}>
        <CloudIcon className="nav-icon" style={{ color: "var(--accent-green)" }} />
        <span className="nav-item-label">Cloud Drive</span>
      </SidebarPageLink>

      {/* Content Editor */}
      {user?.role === "admin" && (
        <SidebarPageLink href="/editor" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
          <EditIcon className="nav-icon" style={{ color: "var(--accent-red)" }} />
          <span className="nav-item-label">Content Editor</span>
        </SidebarPageLink>
      )}
    </nav>
  );
}

// ─── Sidebar Footer ───────────────────────────────────────────────────────────
export function SidebarFooter({ expanded = false }: { expanded?: boolean } = {}) {
  const { user, authStatus } = useAuth();
  const { isCollapsed: desktopCollapsed } = useSidebar();
  const isCollapsed = !expanded && desktopCollapsed;

  return (
    <div className="sidebar-footer">
      {/* Advanced Search */}
      <SidebarPageLink href="/search" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
        <SearchIcon className="nav-icon" />
        <span className="nav-item-label">Advanced Search</span>
      </SidebarPageLink>

      {/* Login — above Settings, guest only */}
      {authStatus === "anonymous" && !user && (
        <SidebarPageLink href="/login" aria-label="Login" className="nav-item" data-tooltip={isCollapsed ? "Login" : undefined}>
          <LoginIcon className="nav-icon" />
          <span className="nav-item-label">Login</span>
        </SidebarPageLink>
      )}

      {user && (
        <SidebarPageLink
          href="/settings"
          aria-label={`Settings${user.role === "admin" ? " (Admin)" : ""}`}
          className="nav-item"
          data-tooltip={isCollapsed ? `Settings${user.role === "admin" ? " (Admin)" : ""}` : undefined}
        >
          <SettingsIcon className="nav-icon" />
          <span className="nav-item-label">Settings{user.role === "admin" && " (Admin)"}</span>
        </SidebarPageLink>
      )}
    </div>
  );
}
