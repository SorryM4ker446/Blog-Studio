"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getPosts, searchResources, getCategories } from "@/lib/api";
import type { Post } from "@/lib/api";
import Link from "next/link";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";

function PostsListContent() {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get("category");

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [currentCategoryName, setCurrentCategoryName] = useState<string | null>(null);

  useEffect(() => {
    loadPosts(1, categoryId || "");
  }, [categoryId]);

  async function loadPosts(pageToLoad: number, catId: string = categoryId || "") {
    setLoading(true);
    const result = await getPosts(pageToLoad, 10, false, "", catId);
    setPosts(result.data);
    setPage(result.page);
    setTotalPages(Math.ceil(result.total / result.limit));

    if (catId) {
      const cats = await getCategories();
      const cat = cats.find((c) => c.id.toString() === catId);
      setCurrentCategoryName(cat ? cat.name : null);
    } else {
      setCurrentCategoryName(null);
    }

    setLoading(false);
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      loadPosts(1, categoryId || "");
      return;
    }
    const res = await searchResources(query, "posts");
    setPosts(res.posts || []);
    setTotalPages(1); // Disable pagination during search
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 className="page-title">
            {currentCategoryName ? `📁 ${currentCategoryName}` : "📋 All Posts"}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
            {currentCategoryName 
              ? `Browsing articles in the ${currentCategoryName} category.` 
              : "Browse all published articles across every category."
            }
          </p>
        </div>
        <SearchInput placeholder="Search posts..." onSearch={handleSearch} style={{ width: "250px" }} />
      </div>

      {loading && posts.length === 0 ? (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton-pulse" style={{ height: "72px", borderRadius: "12px" }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            color: "var(--text-muted)",
            background: "var(--bg-surface)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
          }}
        >
          <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📭</p>
          No posts available yet.
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          {posts.map((post: Post) => (
            <Link key={post.id} href={`/posts/${post.id}`} style={{ textDecoration: "none" }}>
              <div
                className="ai-card"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: "1.2rem 1.5rem",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  className="card-icon"
                  style={{
                    backgroundColor: "rgba(168, 199, 250, 0.12)",
                    color: "var(--accent-blue)",
                    marginRight: "1.2rem",
                    flexShrink: 0,
                  }}
                >
                  📄
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4
                    style={{
                      margin: 0,
                      fontWeight: 500,
                      fontSize: "1.05rem",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {post.title}
                  </h4>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--text-muted)",
                      marginTop: "0.3rem",
                      display: "flex",
                      gap: "0.8rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>
                      {new Date(post.created_at).toLocaleDateString()}
                    </span>
                    <span
                      style={{
                        background: "rgba(109, 214, 140, 0.12)",
                        color: "var(--accent-green)",
                        padding: "1px 8px",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {post.category ? post.category.name : "Uncategorized"}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination component */}
      {!loading && posts.length > 0 && (
        <Pagination 
          currentPage={page} 
          totalPages={totalPages} 
          onPageChange={(p) => loadPosts(p, categoryId || "")} 
        />
      )}

    </div>
  );
}

export default function AllPostsPage() {
  return (
    <Suspense fallback={<div className="skeleton-pulse" style={{ height: "400px", borderRadius: "16px" }} />}>
      <PostsListContent />
    </Suspense>
  );
}
