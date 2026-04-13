"use client";

import React from "react";
import { useSidebar, SidebarContent, SidebarFooter } from "./Providers";
import TopBar from "./TopBar";
import { TriangleIcon, StudioLogo } from "./Icons";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggleSidebar } = useSidebar();

  return (
    <div className="app-container">
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
        <div className="content-scroll">{children}</div>
      </main>
    </div>
  );
}
