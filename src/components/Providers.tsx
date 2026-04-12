"use client";

import { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}

export function SidebarContent() {
  const { user } = useAuth();
  
  return (
    <nav className="nav-menu">
      <a href="/" className="nav-item">
        <span
          className="card-icon"
          style={{
            background: "rgba(255,255,255,0.1)",
            borderRadius: "4px",
          }}
        >
          ⊞
        </span>
        Posts Playground
      </a>

      <div className="nav-group-title">Features</div>
      <a href="/posts" className="nav-item">
        <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
          📋
        </span>
        All Posts
      </a>
      <a href="/drive" className="nav-item">
        <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
          ☁️
        </span>
        Cloud Drive
      </a>
      {user?.role === "admin" && (
        <a href="/editor" className="nav-item">
          <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
            ✏️
          </span>
          Content Editor
        </a>
      )}
    </nav>
  );
}

export function SidebarFooter() {
  const { user, isLoading } = useAuth();
  
  return (
    <div className="sidebar-footer">
      <a href="/search" className="nav-item">
        <span style={{ fontSize: "1.1rem" }}>🔍</span>
        Advanced Search
      </a>
      <a href="/settings" className="nav-item">
        <span style={{ fontSize: "1.1rem" }}>⚙</span>
        Settings {user && "(Admin)"}
      </a>
      {!isLoading && !user && (
        <a href="/login" className="nav-item">
          <span style={{ fontSize: "1.1rem" }}>🔑</span>
          Login
        </a>
      )}
    </div>
  );
}
