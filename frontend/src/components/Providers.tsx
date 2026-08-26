"use client";

import { ReactNode, useEffect, useState, useCallback, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, type Theme } from "@/context/ThemeContext";
import { getCategories, Category } from "@/lib/api";
import type { InitialAppShellState, SidebarCategory } from "@/lib/app-shell-state";
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

  // Sync state to html class for CSS-only initial state (Fix FUS bug)
  useEffect(() => {
    if (isCollapsed) {
      document.documentElement.setAttribute("data-sidebar-state", "collapsed");
    } else {
      document.documentElement.removeAttribute("data-sidebar-state");
    }

    localStorage.setItem("sidebar_collapsed", String(isCollapsed));
    document.cookie = `sidebar_collapsed=${isCollapsed ? "true" : "false"}; path=/; max-age=31536000; samesite=lax`;
  }, [isCollapsed]);

  const toggleSidebar = () => {
    setIsCollapsed((prev) => !prev);
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
        </SidebarContext.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}

// ─── Sidebar Nav ──────────────────────────────────────────────────────────────
export function SidebarContent() {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    isCollapsed,
    initialCategories,
    categoriesResolved,
    initialPostsExpanded,
    initialShowAllCategories,
  } = useSidebar();
  const [categories, setCategories] = useState<SidebarCategory[]>(initialCategories);
  const selectedCategoryId = pathname === "/posts" ? searchParams.get("category") : null;
  const isAllPostsActive = pathname === "/posts" && !selectedCategoryId;
  const [isPostsExpanded, setIsPostsExpanded] = useState(initialPostsExpanded || Boolean(selectedCategoryId));
  const [showAllCategories, setShowAllCategories] = useState(initialShowAllCategories);

  const refreshCategories = useCallback(async () => {
    try {
      const cats: Category[] = await getCategories({ fresh: true });
      setCategories(
        cats
          .filter((c) => (c.post_count || 0) > 0)
          .sort((a, b) => (b.post_count || 0) - (a.post_count || 0))
          .map((category) => ({
            id: category.id,
            name: category.name,
            post_count: category.post_count || 0,
          }))
      );
    } catch {
      // Keep the last successful category list when the public API is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    const frame = categoriesResolved ? 0 : window.requestAnimationFrame(() => {
      void refreshCategories();
    });
    window.addEventListener("blog:refresh-sidebar", refreshCategories);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("blog:refresh-sidebar", refreshCategories);
    };
  }, [categoriesResolved, refreshCategories]);

  return (
    <nav className="nav-menu">
      {/* Posts Playground */}
      <Link href="/" className="nav-item hide-on-collapse">
        <GridIcon className="nav-icon" style={{ color: "var(--accent-yellow)" }} />
        <span className="nav-item-label">Posts Playground</span>
      </Link>

      <div className="nav-group-title">Features</div>

      {/* ── All Posts row ──────────────────────────────────────────────────── */}
      {isCollapsed ? (
        // Collapsed: whole row is a navigation link, sub-menu is hidden
        <Link
          href="/posts"
          className={`nav-item${isAllPostsActive ? " active" : ""}`}
          data-tooltip="All Posts"
          aria-current={isAllPostsActive ? "page" : undefined}
        >
          <ListIcon className="nav-icon active-icon-blue" />
        </Link>
      ) : (
        // Expanded: link + separate chevron button
        <div className={`nav-posts-row${isAllPostsActive ? " active" : ""}`}>
          <Link href="/posts" className="nav-posts-link" aria-current={isAllPostsActive ? "page" : undefined}>
            <ListIcon className="nav-icon active-icon-blue" />
            <span className="nav-item-label">All Posts</span>
          </Link>
          <button
            type="button"
            className="nav-posts-chevron"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsPostsExpanded((current) => {
                const next = !current;
                document.cookie = `sidebar_posts_expanded=${next}; path=/; max-age=31536000; samesite=lax`;
                return next;
              });
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
      )}

      {/* Categories sub-menu */}
      {!isCollapsed && categories.length > 0 && (
        <div
          className={`sidebar-categories${isPostsExpanded ? " expanded" : ""}`}
          aria-hidden={!isPostsExpanded}
        >
          <div className="sidebar-categories-inner">
            {categories.slice(0, showAllCategories ? categories.length : 3).map((cat) => {
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
            })}

            {categories.length > 3 && (
              <button
                type="button"
                className="sidebar-categories-more"
                onClick={() => {
                  const next = !showAllCategories;
                  document.cookie = `sidebar_categories_all=${next}; path=/; max-age=31536000; samesite=lax`;
                  setShowAllCategories(next);
                }}
              >
                {showAllCategories ? "Less" : "More"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cloud Drive */}
      <Link href="/drive" className={`nav-item hide-on-collapse nav-cloud-drive${!isCollapsed && isPostsExpanded ? " categories-expanded" : ""}`}>
        <CloudIcon className="nav-icon" style={{ color: "var(--accent-green)" }} />
        <span className="nav-item-label">Cloud Drive</span>
      </Link>

      {/* Content Editor */}
      {user?.role === "admin" && (
        <Link href="/editor" className="nav-item hide-on-collapse">
          <EditIcon className="nav-icon" style={{ color: "var(--accent-red)" }} />
          <span className="nav-item-label">Content Editor</span>
        </Link>
      )}
    </nav>
  );
}

// ─── Sidebar Footer ───────────────────────────────────────────────────────────
export function SidebarFooter() {
  const { user, authStatus } = useAuth();
  const { isCollapsed } = useSidebar();

  return (
    <div className="sidebar-footer">
      {/* Advanced Search */}
      <Link href="/search" className="nav-item hide-on-collapse">
        <SearchIcon className="nav-icon" />
        <span className="nav-item-label">Advanced Search</span>
      </Link>

      {/* Login — above Settings, guest only */}
      {authStatus === "anonymous" && !user && (
        <Link href="/login" className="nav-item" data-tooltip={isCollapsed ? "Login" : undefined}>
          <LoginIcon className="nav-icon" />
          <span className="nav-item-label">Login</span>
        </Link>
      )}

      {user && (
        <Link
          href="/settings"
          className="nav-item"
          data-tooltip={isCollapsed ? `Settings${user.role === "admin" ? " (Admin)" : ""}` : undefined}
        >
          <SettingsIcon className="nav-icon" />
          <span className="nav-item-label">Settings{user.role === "admin" && " (Admin)"}</span>
        </Link>
      )}
    </div>
  );
}
