"use client";

import { ReactNode, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { getCategories, Category } from "@/lib/api";

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [isPostsExpanded, setIsPostsExpanded] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const refreshCategories = useCallback(() => {
    getCategories().then((cats) => {
      setCategories(
        cats
          .filter((c) => (c.post_count || 0) > 0)
          .sort((a, b) => (b.post_count || 0) - (a.post_count || 0))
      );
    });
  }, []);

  useEffect(() => {
    setMounted(true);
    refreshCategories();

    // Listen for custom refresh events
    window.addEventListener("blog:refresh-sidebar", refreshCategories);
    return () => {
      window.removeEventListener("blog:refresh-sidebar", refreshCategories);
    };
  }, [refreshCategories]);
  
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
      
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Link 
          href="/posts" 
          onClick={(e) => {
             // Let the navigation happen, but also toggle the menu
             setIsPostsExpanded(!isPostsExpanded);
          }}
          className="nav-item"
          style={{ marginBottom: 0 }}
        >
          <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>📋</span>
          <span style={{ flex: 1 }}>All Posts</span>
          <span style={{ 
            fontSize: "0.7rem", 
            color: "var(--text-muted)",
            transform: isPostsExpanded ? "rotate(180deg)" : "rotate(0)", 
            transition: "transform 0.2s" 
          }}>▼</span>
        </Link>
        
        {/* Categories Sub-menu */}
        {isPostsExpanded && categories.length > 0 && (
          <div className="fade-in" style={{ 
            marginLeft: "2.3rem", 
            paddingTop: "0.2rem", 
            display: "flex", 
            flexDirection: "column", 
            gap: "0.1rem" 
          }}>
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
                  fontSize: "0.9rem",
                  padding: "0.4rem 0.5rem",
                  borderRadius: "6px",
                  transition: "background 0.2s, color 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
              >
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: "0.5rem" }}>
                  {cat.name}
                </span>
                <span style={{ 
                  background: "var(--accent-blue)", 
                  color: "#fff", 
                  fontSize: "0.75rem", 
                  padding: "1px 8px", 
                  borderRadius: "10px", 
                  fontWeight: 600 
                }}>
                  {cat.post_count}
                </span>
              </Link>
            ))}
            
            {/* More Button */}
            {!showAllCategories && categories.length > 3 && (
              <div 
                onClick={() => setShowAllCategories(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-blue)",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  padding: "0.4rem",
                  marginTop: "0.2rem",
                  width: "100%",
                  opacity: 0.8,
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "0.8"}
              >
                More
              </div>
            )}
            
            {showAllCategories && categories.length > 3 && (
              <div 
                onClick={() => setShowAllCategories(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  padding: "0.4rem",
                  marginTop: "0.2rem",
                  width: "100%"
                }}
              >
                Less
              </div>
            )}
          </div>
        )}
      </div>

      <Link href="/drive" className="nav-item" style={{ marginTop: isPostsExpanded ? "0.5rem" : 0 }}>
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
