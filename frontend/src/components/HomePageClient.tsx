"use client";

import { formatDate } from "@/lib/display-date";

import { useState, useRef } from "react";
import { useEditorRouter as useRouter } from "@/lib/use-editor-router";
import { getApiErrorMessage, getPostTimeline, getPosts } from "@/lib/api";
import type { PostSummary } from "@/lib/api";
import { 
  FileTextIcon, 
  SearchIcon, 
  EnterIcon 
} from "@/components/Icons";
import Link from "next/link";
import HomeLinks from "./links/HomeLinks";
import type { HomepageLink } from "@/lib/links";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AsyncState";

export default function HomePageClient({
  initialPosts,
  initialPostsError = "",
  initialLinks = [],
  initialLinksError = "",
}: {
  initialPosts: PostSummary[];
  initialPostsError?: string;
  initialLinks?: HomepageLink[];
  initialLinksError?: string;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostSummary[]>(initialPosts);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState(initialPostsError);
  const [searchQuery, setSearchQuery] = useState("");
  const loadRequestIdRef = useRef(0);

  async function loadPosts() {
    const requestId = ++loadRequestIdRef.current;
    setPostsLoading(true);
    setPostsError("");
    try {
      const result = await getPosts(1, 5);
      if (requestId !== loadRequestIdRef.current) return;
      setPosts(result.data);
    } catch (error) {
      if (requestId === loadRequestIdRef.current) {
        setPostsError(getApiErrorMessage(error, "Could not load recent articles."));
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setPostsLoading(false);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  return (
    <div>
      <h1 className="page-title">Explore Blog posts</h1>

      <HomeLinks initialLinks={initialLinks} initialError={initialLinksError} />

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
          {postsLoading ? (
            <LoadingState label="Loading recent articles…" rows={3} />
          ) : postsError ? (
            <ErrorState title="Recent articles could not be loaded" message={postsError} onRetry={() => void loadPosts()} />
          ) : posts.length === 0 ? (
            <EmptyState title="No posts available yet" message="Published articles will appear here." />
          ) : (
            posts.map((post: PostSummary) => (
              <Link key={post.id} href={`/posts/${post.id}`} style={{ textDecoration: "none" }}>
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
                    <FileTextIcon size={16} />
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
                      {getPostTimeline(post).label} on{" "}
                      {formatDate(getPostTimeline(post).timestamp)} •{" "}
                      {post.category ? post.category.name : "Uncategorized"}
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

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
          <SearchIcon size={20} style={{ opacity: 0.5 }} />
          <input
            id="home-search-bar"
            aria-label="Search posts and files"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search articles or type a prompt to explore my writings..."
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              color: "var(--text-primary)",
              fontSize: "0.95rem",
              outline: "none",
              padding: "0.5rem 0",
            }}
          />
          <button
            type="button"
            aria-label="Submit search"
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
              border: 0,
              color: "var(--text-primary)",
            }}
          >
            <EnterIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
