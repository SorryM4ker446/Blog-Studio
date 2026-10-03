"use client";

import { type ComponentProps, useContext, useId, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useSidebar, SidebarSelectionContext } from "@/context/SidebarContext";
import type { SidebarCategory } from "@/lib/app-shell-state";
import { writePreference } from "@/lib/preference-cookies";
import { GridIcon, ListIcon, CloudIcon, EditIcon, SearchIcon, SettingsIcon, LoginIcon, ChevronDownIcon } from "@/components/Icons";

function SidebarPageLink({ href, className = "", ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const selection = useContext(SidebarSelectionContext) ?? pathname;
  const active = selection === href;
  return <Link {...props} href={href} data-sidebar-section={href} className={`${className}${active && href !== "/" ? " active" : ""}`} aria-current={active ? "page" : undefined} />;
}

export function SidebarContent({ expanded = false }: { expanded?: boolean } = {}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selection = useContext(SidebarSelectionContext);
  const {
    isCollapsed: desktopCollapsed,
    categories,
    initialPostsExpanded,
    initialShowAllCategories,
  } = useSidebar();
  const isCollapsed = !expanded && desktopCollapsed;
  const selectedCategoryId = selection?.startsWith("/posts?") ? new URLSearchParams(selection.split("?")[1]).get("category") : pathname === "/posts" ? searchParams.get("category") : null;
  const isAllPostsActive = selection !== null ? selection === "/posts" : (pathname === "/posts" && !selectedCategoryId) || pathname.startsWith("/posts/");
  const [isPostsExpanded, setIsPostsExpanded] = useState(initialPostsExpanded || Boolean(selectedCategoryId));
  const [showAllCategories, setShowAllCategories] = useState(initialShowAllCategories);
  const extraCategoriesId = useId();

  const renderCategory = (cat: SidebarCategory) => {
    const isActive = selectedCategoryId === cat.id.toString();
    return (
      <Link
        key={cat.id}
        href={`/posts?category=${cat.id}`}
        data-sidebar-section={`/posts?category=${cat.id}`}
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
      <SidebarPageLink href="/" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
        <GridIcon className="nav-icon" style={{ color: "var(--accent-yellow)" }} />
        <span className="nav-item-label">Posts Playground</span>
      </SidebarPageLink>

      <div className="nav-group-title">Features</div>

      <div data-sidebar-section="/posts" className={`nav-posts-row${isAllPostsActive ? " active" : ""}`}>
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

      <SidebarPageLink href="/drive" inert={isCollapsed} aria-hidden={isCollapsed} className={`nav-item hide-on-collapse nav-cloud-drive${!isCollapsed && isPostsExpanded ? " categories-expanded" : ""}`}>
        <CloudIcon className="nav-icon" style={{ color: "var(--accent-green)" }} />
        <span className="nav-item-label">Cloud Drive</span>
      </SidebarPageLink>

      {user?.role === "admin" && (
        <SidebarPageLink href="/editor" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
          <EditIcon className="nav-icon" style={{ color: "var(--accent-red)" }} />
          <span className="nav-item-label">Content Editor</span>
        </SidebarPageLink>
      )}
    </nav>
  );
}

export function SidebarFooter({ expanded = false }: { expanded?: boolean } = {}) {
  const { user, authStatus } = useAuth();
  const { isCollapsed: desktopCollapsed } = useSidebar();
  const isCollapsed = !expanded && desktopCollapsed;

  return (
    <div className="sidebar-footer">
      <SidebarPageLink href="/search" className="nav-item hide-on-collapse" inert={isCollapsed} aria-hidden={isCollapsed}>
        <SearchIcon className="nav-icon" />
        <span className="nav-item-label">Advanced Search</span>
      </SidebarPageLink>

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
