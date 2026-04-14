"use client";

import { ReactNode, useEffect, useState, useCallback, createContext, useContext } from "react";
import Link from "next/link";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { getCategories, Category } from "@/lib/api";
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
}: {
  children: ReactNode;
  initialSidebarCollapsed?: boolean;
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
    <ThemeProvider>
      <AuthProvider>
        <SidebarContext.Provider value={{ isCollapsed, toggleSidebar }}>
          {children}
        </SidebarContext.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}

// ─── Sidebar Nav ──────────────────────────────────────────────────────────────
export function SidebarContent() {
  const { user } = useAuth();
  const { isCollapsed } = useSidebar();
  const [mounted, setMounted] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isPostsExpanded, setIsPostsExpanded] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const refreshCategories = useCallback(() => {
    getCategories().then((cats) =>
      setCategories(
        cats
          .filter((c) => (c.post_count || 0) > 0)
          .sort((a, b) => (b.post_count || 0) - (a.post_count || 0))
      )
    );
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMounted(true);
    });
    refreshCategories();
    window.addEventListener("blog:refresh-sidebar", refreshCategories);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("blog:refresh-sidebar", refreshCategories);
    };
  }, [refreshCategories]);

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
        <Link href="/posts" className="nav-item" data-tooltip="All Posts">
          <ListIcon className="nav-icon active-icon-blue" />
        </Link>
      ) : (
        // Expanded: link + separate chevron button
        <div className="nav-posts-row">
          <Link href="/posts" className="nav-posts-link">
            <ListIcon className="nav-icon active-icon-blue" />
            <span className="nav-item-label">All Posts</span>
          </Link>
          <div
            className="nav-posts-chevron"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsPostsExpanded((v) => !v);
            }}
            role="button"
            aria-label="Toggle categories"
          >
            <ChevronDownIcon
              size={14}
              style={{
                transition: "transform 0.25s ease",
                transform: isPostsExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </div>
        </div>
      )}

      {/* Categories sub-menu */}
      {!isCollapsed && isPostsExpanded && categories.length > 0 && (
        <div
          className="fade-in"
          style={{ marginLeft: "2.2rem", paddingTop: "0.15rem", display: "flex", flexDirection: "column", gap: "0.05rem" }}
        >
          {categories.slice(0, showAllCategories ? categories.length : 3).map((cat) => (
            <Link
              key={cat.id}
              href={`/posts?category=${cat.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textDecoration: "none",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                padding: "0.35rem 0.6rem",
                borderRadius: "8px",
                transition: "background 0.18s, color 0.18s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", marginRight: "0.5rem" }}>
                {cat.name}
              </span>
              <span style={{ background: "var(--accent-blue)", color: "#fff", fontSize: "0.72rem", padding: "1px 7px", borderRadius: "10px", fontWeight: 600, flexShrink: 0 }}>
                {cat.post_count}
              </span>
            </Link>
          ))}

          {!showAllCategories && categories.length > 3 && (
            <div onClick={() => setShowAllCategories(true)} style={{ textAlign: "center", color: "var(--accent-blue)", fontSize: "0.82rem", cursor: "pointer", padding: "0.3rem", opacity: 0.85 }}>
              More
            </div>
          )}
          {showAllCategories && categories.length > 3 && (
            <div onClick={() => setShowAllCategories(false)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", cursor: "pointer", padding: "0.3rem" }}>
              Less
            </div>
          )}
        </div>
      )}

      {/* Cloud Drive */}
      <Link href="/drive" className="nav-item hide-on-collapse" style={{ marginTop: (!isCollapsed && isPostsExpanded) ? "0.25rem" : 0 }}>
        <CloudIcon className="nav-icon" style={{ color: "var(--accent-green)" }} />
        <span className="nav-item-label">Cloud Drive</span>
      </Link>

      {/* Content Editor */}
      {mounted && user?.role === "admin" && (
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
  const { user, isLoading } = useAuth();
  const { isCollapsed } = useSidebar();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="sidebar-footer">
      {/* Advanced Search */}
      <Link href="/search" className="nav-item hide-on-collapse">
        <SearchIcon className="nav-icon" />
        <span className="nav-item-label">Advanced Search</span>
      </Link>

      {/* Login — above Settings, guest only */}
      {mounted && !isLoading && !user && (
        <Link href="/login" className="nav-item" data-tooltip={isCollapsed ? "Login" : undefined}>
          <LoginIcon className="nav-icon" />
          <span className="nav-item-label">Login</span>
        </Link>
      )}

      {/* Settings — always visible at the bottom */}
      <Link
        href="/settings"
        className="nav-item"
        data-tooltip={isCollapsed ? `Settings${mounted && user ? " (Admin)" : ""}` : undefined}
      >
        <SettingsIcon className="nav-icon" />
        <span className="nav-item-label">Settings{mounted && user && " (Admin)"}</span>
      </Link>
    </div>
  );
}
