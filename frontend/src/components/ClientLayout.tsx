"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSidebar, SidebarContent, SidebarFooter } from "./Providers";
import TopBar from "./TopBar";
import MobileNavigation from "./MobileNavigation";
import { TriangleIcon, StudioLogo } from "./Icons";
import { createSidebarLayoutMotion } from "@/lib/sidebar-layout-motion";
import { readNavigationEntry, saveEntryScroll } from "@/lib/navigation-entry";
import { restoreScroll } from "@/lib/restore-scroll";

function getLocationKey(pathname: string, searchParams: URLSearchParams | Readonly<URLSearchParams>) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function RouteTransitionContent({
  children,
  routeKey,
}: {
  children: React.ReactNode;
  routeKey: string;
}) {
  const [transition, setTransition] = useState({ routeKey, isEntering: false });

  if (transition.routeKey !== routeKey) {
    setTransition({ routeKey, isEntering: true });
  }

  const isEntering = transition.routeKey === routeKey && transition.isEntering;

  return (
    <div
      key={routeKey}
      className={`route-transition-frame${isEntering ? " route-transition-active" : ""}`}
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) {
          setTransition((current) => ({ ...current, isEntering: false }));
        }
      }}
    >
      {children}
    </div>
  );
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const previousPathRef = useRef(pathname);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarMotionRef = useRef<ReturnType<typeof createSidebarLayoutMotion> | null>(null);
  const historyTraversalRef = useRef(false);
  const initialLocationRef = useRef(true);
  const focusAfterNavigationRef = useRef(false);
  const navigationStartedRef = useRef(false);
  const restorationInProgressRef = useRef(false);
  const cancelRestorationRef = useRef<(() => void) | undefined>(undefined);
  const categoryId = pathname === "/posts" ? searchParams.get("category") : null;
  const routeKey = categoryId ? `${pathname}?category=${categoryId}` : pathname;
  const locationKey = getLocationKey(pathname, searchParams);
  const committedLocationRef = useRef(locationKey);

  useEffect(() => () => {
    sidebarMotionRef.current?.dispose();
    sidebarMotionRef.current = null;
  }, [locationKey]);

  function handleSidebarToggle() {
    if (contentScrollRef.current) {
      sidebarMotionRef.current ??= createSidebarLayoutMotion(contentScrollRef.current);
      sidebarMotionRef.current.start();
    }
    toggleSidebar();
  }

  useEffect(() => {
    const markHistoryTraversal = () => {
      historyTraversalRef.current = true;
      if (getLocationKey(window.location.pathname, new URLSearchParams(window.location.search)) === committedLocationRef.current && contentScrollRef.current) {
        historyTraversalRef.current = false;
        cancelRestorationRef.current?.();
        const position = readNavigationEntry()?.scroll;
        if (position !== undefined) {
          restorationInProgressRef.current = true;
          cancelRestorationRef.current = restoreScroll(contentScrollRef.current, position, () => { restorationInProgressRef.current = false; });
        }
      }
    };
    window.addEventListener("popstate", markHistoryTraversal);
    return () => window.removeEventListener("popstate", markHistoryTraversal);
  }, []);

  useLayoutEffect(() => {
    committedLocationRef.current = locationKey;
    navigationStartedRef.current = false;
    const navigation = initialLocationRef.current ? performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined : undefined;
    const reloaded = navigation?.type === "reload" || navigation?.type === "back_forward";
    const cancelledBeforeHydration = initialLocationRef.current && document.documentElement.hasAttribute("data-initial-scroll-cancelled");
    document.documentElement.removeAttribute("data-initial-scroll-cancelled");
    window.dispatchEvent(new Event("blog:initial-view-ready"));
    initialLocationRef.current = false;
    const pathChanged = previousPathRef.current !== pathname;
    previousPathRef.current = pathname;
    focusAfterNavigationRef.current = false;
    if (cancelledBeforeHydration || (!historyTraversalRef.current && !reloaded)) {
      focusAfterNavigationRef.current = pathChanged;
      restorationInProgressRef.current = false;
      return;
    }
    historyTraversalRef.current = false;

    const savedPosition = readNavigationEntry()?.scroll;
    if (savedPosition === undefined || !contentScrollRef.current) return;
    restorationInProgressRef.current = true;
    cancelRestorationRef.current = restoreScroll(contentScrollRef.current, savedPosition, () => { restorationInProgressRef.current = false; });
    return () => cancelRestorationRef.current?.();
  }, [locationKey, pathname]);

  useEffect(() => () => cancelRestorationRef.current?.(), []);

  useEffect(() => {
    // The mobile drawer releases modal isolation in its effect before focus moves.
    if (focusAfterNavigationRef.current && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
      mainRef.current?.focus({ preventScroll: true });
    }
    focusAfterNavigationRef.current = false;
  }, [locationKey, pathname]);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      if (restorationInProgressRef.current || navigationStartedRef.current || !contentScrollRef.current) return;
      storeContentScroll(locationKey, contentScrollRef.current.scrollTop);
    };
    window.addEventListener("beforeunload", saveBeforeLeaving);
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => {
      window.removeEventListener("beforeunload", saveBeforeLeaving);
      window.removeEventListener("pagehide", saveBeforeLeaving);
    };
  }, [locationKey]);

  function storeContentScroll(expectedLocation: string, position: number) {
    if (getLocationKey(window.location.pathname, new URLSearchParams(window.location.search)) === expectedLocation) saveEntryScroll(position);
  }

  function handleContentScroll(event: React.UIEvent<HTMLDivElement>) {
    if (navigationStartedRef.current || restorationInProgressRef.current) return;
    const position = event.currentTarget.scrollTop;
    storeContentScroll(locationKey, position);
  }

  function rememberContentScroll(event: React.MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>("a[href]");
    const scrollContainer = contentScrollRef.current;
    if (!link || !scrollContainer || link.target === "_blank" || link.hasAttribute("download")) {
      return;
    }

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin
      || (destination.pathname === window.location.pathname && destination.search === window.location.search)) {
      return;
    }

    storeContentScroll(locationKey, scrollContainer.scrollTop);
    navigationStartedRef.current = true;
  }

  return (
    <div className="app-container" onClickCapture={rememberContentScroll}>
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); mainRef.current?.focus({ preventScroll: true }); }}>Skip to main content</a>
      {/* 左侧导航栏 */}
      <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
        {/* Header: logo text animates out via CSS, toggle always visible */}
        <div className="sidebar-header">
          {/* Logo container handles logo shrinking via max-width / opacity in CSS */}
          <div className="sidebar-logo-container">
            <StudioLogo className="sidebar-logo-icon" size={24} />
            <span className="sidebar-logo-text">Blog Studio</span>
          </div>
          
          <button
            className="sidebar-toggle"
            onClick={handleSidebarToggle}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <TriangleIcon size={16} />
          </button>
        </div>

        <SidebarContent />
        <SidebarFooter />
      </aside>

      {/* 右侧主内容区 */}
      <main ref={mainRef} id="main-content" tabIndex={-1} className="main-content">
        <TopBar navigation={<MobileNavigation />} />
        <div className="content-scroll" ref={contentScrollRef} onScroll={handleContentScroll}>
          <RouteTransitionContent routeKey={routeKey}>
            {children}
          </RouteTransitionContent>
        </div>
      </main>
    </div>
  );
}
