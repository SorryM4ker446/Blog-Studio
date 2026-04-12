"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  return (
    <nav className="nav-menu">

      <Link href="/" className="nav-item">
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
      </Link>

      <div className="nav-group-title">Features</div>
      <Link href="/posts" className="nav-item">
        <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
          📋
        </span>
        All Posts
      </Link>
      <Link href="/drive" className="nav-item">
        <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
          ☁️
        </span>
        Cloud Drive
      </Link>
      {mounted && user?.role === "admin" && (
        <Link href="/editor" className="nav-item">
          <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>
            ✏️
          </span>
          Content Editor
        </Link>
      )}

    </nav>
  );
}

export function SidebarFooter() {
  const { user, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  return (

    <div className="sidebar-footer">
      <Link href="/search" className="nav-item">
        <span style={{ fontSize: "1.1rem" }}>🔍</span>
        Advanced Search
      </Link>
      <Link href="/settings" className="nav-item">
        <span style={{ fontSize: "1.1rem" }}>⚙</span>
        Settings {mounted && user && "(Admin)"}
      </Link>
      {mounted && !isLoading && !user && (
        <Link href="/login" className="nav-item">
          <span style={{ fontSize: "1.1rem" }}>🔑</span>
          Login
        </Link>
      )}

    </div>
  );
}
