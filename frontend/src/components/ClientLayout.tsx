"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSidebar, SidebarContent, SidebarFooter } from "./Providers";
import TopBar from "./TopBar";
import { TriangleIcon, StudioLogo } from "./Icons";

const contentScrollStoragePrefix = "blogStudio:contentScroll:";

function getLocationKey(pathname: string, searchParams: URLSearchParams | Readonly<URLSearchParams>) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getContentScrollStorageKey(location: string) {
  return `${contentScrollStoragePrefix}${encodeURIComponent(location)}`;
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
  const historyTraversalRef = useRef(false);
  const navigationStartedRef = useRef(false);
  const restorationInProgressRef = useRef(false);
  const scrollSaveFrameRef = useRef(0);
  const categoryId = pathname === "/posts" ? searchParams.get("category") : null;
  const routeKey = categoryId ? `${pathname}?category=${categoryId}` : pathname;
  const locationKey = getLocationKey(pathname, searchParams);
  const scrollStorageKey = getContentScrollStorageKey(locationKey);

  useEffect(() => {
    const markHistoryTraversal = () => {
      historyTraversalRef.current = true;
    };
    window.addEventListener("popstate", markHistoryTraversal);
    return () => window.removeEventListener("popstate", markHistoryTraversal);
  }, []);

  useEffect(() => {
    navigationStartedRef.current = false;
    if (!historyTraversalRef.current) {
      restorationInProgressRef.current = false;
      return;
    }
    historyTraversalRef.current = false;

    let savedPosition = Number.NaN;
    try {
      savedPosition = Number.parseFloat(window.sessionStorage.getItem(scrollStorageKey) || "");
    } catch {
      return;
    }
    if (!Number.isFinite(savedPosition)) {
      return;
    }

    restorationInProgressRef.current = true;
    let restoreFrame = 0;
    let attempts = 0;
    const restorePosition = () => {
      const scrollContainer = contentScrollRef.current;
      if (!scrollContainer) {
        restorationInProgressRef.current = false;
        return;
      }

      scrollContainer.scrollTop = Math.max(0, savedPosition);
      attempts += 1;
      if (Math.abs(scrollContainer.scrollTop - savedPosition) <= 1 || attempts >= 120) {
        restorationInProgressRef.current = false;
        return;
      }
      restoreFrame = window.requestAnimationFrame(restorePosition);
    };
    restoreFrame = window.requestAnimationFrame(restorePosition);
    return () => {
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      restorationInProgressRef.current = false;
    };
  }, [scrollStorageKey]);

  useEffect(() => () => {
    if (scrollSaveFrameRef.current) window.cancelAnimationFrame(scrollSaveFrameRef.current);
  }, []);

  function storeContentScroll(storageKey: string, position: number) {
    try {
      window.sessionStorage.setItem(storageKey, position.toString());
    } catch {
      // Navigation and scrolling should still work when storage is unavailable.
    }
  }

  function handleContentScroll(event: React.UIEvent<HTMLDivElement>) {
    if (navigationStartedRef.current || restorationInProgressRef.current) return;
    if (scrollSaveFrameRef.current) window.cancelAnimationFrame(scrollSaveFrameRef.current);
    const position = event.currentTarget.scrollTop;
    scrollSaveFrameRef.current = window.requestAnimationFrame(() => {
      storeContentScroll(scrollStorageKey, position);
      scrollSaveFrameRef.current = 0;
    });
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
    if (destination.origin !== window.location.origin) {
      return;
    }

    if (scrollSaveFrameRef.current) window.cancelAnimationFrame(scrollSaveFrameRef.current);
    scrollSaveFrameRef.current = 0;
    storeContentScroll(scrollStorageKey, scrollContainer.scrollTop);
    navigationStartedRef.current = true;
  }

  return (
    <div className="app-container" onClickCapture={rememberContentScroll}>
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
            onClick={toggleSidebar}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <TriangleIcon size={16} />
          </button>
        </div>

        <SidebarContent />
        <SidebarFooter />
      </aside>

      {/* 右侧主内容区 */}
      <main className="main-content">
        <TopBar />
        <div className="content-scroll" ref={contentScrollRef} onScroll={handleContentScroll}>
          <RouteTransitionContent routeKey={routeKey}>
            {children}
          </RouteTransitionContent>
        </div>
      </main>
    </div>
  );
}
