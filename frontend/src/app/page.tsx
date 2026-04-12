"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPosts } from "@/lib/api";
import type { Post } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    // Only load the first 5 posts directly from the backend for the recent list
    const result = await getPosts(1, 5);
    setPosts(result.data);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  return (
    <div>
      <h1 className="page-title">Explore Blog posts</h1>

      {/* 网格四象限卡片 */}
      <div className="card-grid">
        <div className="ai-card">
          <div className="card-header">
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(251, 210, 132, 0.15)",
                color: "var(--accent-yellow)",
              }}
            >
              ☆
            </div>
            Featured Post
          </div>
          <p className="card-desc">
            Test out my most advanced and newly published coding tutorials.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(168, 199, 250, 0.15)",
                color: "var(--accent-blue)",
              }}
            >
              □
            </div>
            Code and Backend
          </div>
          <p className="card-desc">
            Build RESTful APIs, scalable services, and database tuning with Go.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(109, 214, 140, 0.15)",
                color: "var(--accent-green)",
              }}
            >
              ▣
            </div>
            Frontend UI
          </div>
          <p className="card-desc">
            Generate and engineer pixel-perfect Next.js web applications.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(242, 139, 130, 0.15)",
                color: "var(--accent-red)",
              }}
            >
              ⚡
            </div>
            Real-time Thoughts
          </div>
          <p className="card-desc">
            Read real-time insights, journals, and reflections on development
            life.
          </p>
        </div>
      </div>

      {/* 博客文章列表 */}
      <div style={{ marginTop: "3.5rem" }}>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            marginBottom: "1rem",
          }}
        >
          Recent Articles →
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {posts.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              No posts available yet.
            </div>
          ) : (
            posts.map((post: Post) => (
              <a key={post.id} href={`/posts/${post.id}`}>
                <div
                  className="ai-card"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "1rem 1.5rem",
                  }}
                >
                  <div
                    className="card-icon"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      marginRight: "1.2rem",
                    }}
                  >
                    📄
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4
                      style={{
                        margin: 0,
                        fontWeight: 500,
                        fontSize: "1.05rem",
                      }}
                    >
                      {post.title}
                    </h4>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-muted)",
                        marginTop: "0.3rem",
                      }}
                    >
                      Posted on{" "}
                      {new Date(post.created_at).toLocaleDateString()} •{" "}
                      {post.category ? post.category.name : "Uncategorized"}
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {/* 底部搜索栏 - 真实搜索功能 */}
      <div
        style={{
          marginTop: "6rem",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-color)",
            borderTopRightRadius: "8px",
            borderTopLeftRadius: "8px",
            borderBottomRightRadius: "24px",
            borderBottomLeftRadius: "24px",
            padding: "0.6rem 1.5rem",
            display: "flex",
            width: "100%",
            maxWidth: "800px",
            alignItems: "center",
            gap: "0.8rem",
          }}
        >
          <span style={{ fontSize: "1.1rem", opacity: 0.5 }}>🔍</span>
          <input
            id="home-search-bar"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search articles or type a prompt to explore my writings..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--text-primary)",
              fontSize: "0.95rem",
              outline: "none",
              padding: "0.5rem 0",
            }}
          />
          <div
            onClick={() => {
              if (searchQuery.trim()) {
                router.push(
                  `/search?q=${encodeURIComponent(searchQuery.trim())}`
                );
              }
            }}
            className="card-icon"
            style={{
              background: "rgba(255,255,255,0.08)",
              borderRadius: "50%",
              padding: "6px",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            ↩
          </div>
        </div>
      </div>
    </div>
  );
}
