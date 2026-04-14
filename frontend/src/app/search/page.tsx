"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import type { Post, FileRecord } from "@/lib/api";
import { searchResources, getDownloadUrl } from "@/lib/api";
import { 
  SearchIcon, 
  FileTextIcon, 
  FolderIcon, 
  PaperclipIcon, 
  DownloadIcon 
} from "@/components/Icons";

function SearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const doSearch = async (q: string) => {
    const normalizedQuery = q.trim();
    if (!normalizedQuery) {
      setPosts([]);
      setFiles([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    setLoading(true);
    const result = await searchResources(normalizedQuery);
    if (!isMountedRef.current || requestId !== searchRequestIdRef.current) {
      return;
    }
    setPosts(result.posts);
    setFiles(result.files);
    setSearched(true);
    setLoading(false);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (initialQuery) {
        setQuery(initialQuery);
        doSearch(initialQuery);
      } else {
        setQuery("");
        setPosts([]);
        setFiles([]);
        setSearched(false);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialQuery]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      doSearch(query);
    }
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.80rem" }}>
        <SearchIcon size={28} /> Search
      </h1>
      <p
        style={{
          color: "var(--text-secondary)",
          fontSize: "0.9rem",
          marginBottom: "1.5rem",
        }}
      >
        Search across all posts and cloud drive files.
      </p>

      {/* 搜索输入框 */}
      <div
        style={{
          display: "flex",
          gap: "0.8rem",
          marginBottom: "2rem",
        }}
      >
        <input
          id="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your search query and press Enter..."
          autoFocus
          style={{
            flex: 1,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "0.8rem 1.2rem",
            color: "var(--text-primary)",
            fontSize: "1rem",
            outline: "none",
            transition: "border-color 0.2s",
          }}
        />
        <button
          onClick={() => doSearch(query)}
          style={{
            background: "var(--accent-blue)",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            padding: "0 1.5rem",
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
        >
          Search
        </button>
      </div>

      {loading && (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "0.8rem", padding: "1rem 0" }}>
          <div className="skeleton-pulse" style={{ height: "60px", borderRadius: "10px" }} />
          <div className="skeleton-pulse" style={{ height: "60px", borderRadius: "10px" }} />
        </div>
      )}

      {searched && !loading && (
        <div>
          {/* 文章结果 */}
          <div style={{ marginBottom: "2rem" }}>
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
                marginBottom: "0.8rem",
                fontWeight: 500,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FileTextIcon size={16} /> Posts ({posts.length} results)
              </div>
            </div>
            {posts.length === 0 ? (
              <div
                style={{
                  padding: "1.5rem",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  background: "var(--bg-surface)",
                  borderRadius: "10px",
                  border: "1px solid var(--border-color)",
                  fontSize: "0.9rem",
                }}
              >
                No matching posts found.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {posts.map((post) => (
                  <Link key={post.id} href={`/posts/${post.id}`} style={{ textDecoration: "none" }}>
                    <div
                      className="ai-card"
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: "1rem 1.2rem",
                      }}
                    >
                      <div
                        className="card-icon"
                        style={{
                          backgroundColor: "rgba(168, 199, 250, 0.12)",
                          color: "var(--accent-blue)",
                          marginRight: "1rem",
                          flexShrink: 0,
                        }}
                      >
                        <FileTextIcon size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h4
                          style={{
                            margin: 0,
                            fontWeight: 500,
                            fontSize: "0.95rem",
                          }}
                        >
                          {post.title}
                        </h4>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                            marginTop: "0.2rem",
                          }}
                        >
                          {new Date(post.created_at).toLocaleDateString()} •{" "}
                          {post.category?.name || "Uncategorized"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 文件结果 */}
          <div>
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.85rem",
                marginBottom: "0.8rem",
                fontWeight: 500,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FolderIcon size={16} /> Files ({files.length} results)
              </div>
            </div>
            {files.length === 0 ? (
              <div
                style={{
                  padding: "1.5rem",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  background: "var(--bg-surface)",
                  borderRadius: "10px",
                  border: "1px solid var(--border-color)",
                  fontSize: "0.9rem",
                }}
              >
                No matching files found.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="ai-card"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: "1rem 1.2rem",
                    }}
                  >
                    <div
                      className="card-icon"
                      style={{
                        backgroundColor: "rgba(109, 214, 140, 0.12)",
                        color: "var(--accent-green)",
                        marginRight: "1rem",
                        flexShrink: 0,
                      }}
                    >
                      <PaperclipIcon size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4
                        style={{
                          margin: 0,
                          fontWeight: 500,
                          fontSize: "0.95rem",
                        }}
                      >
                        {file.orig_name}
                      </h4>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--text-muted)",
                          marginTop: "0.2rem",
                        }}
                      >
                        {(file.size / 1024).toFixed(1)} KB • {file.mime_type}
                      </div>
                    </div>
                    <a
                      href={getDownloadUrl(file.id)}
                      style={{
                        background: "rgba(109, 214, 140, 0.12)",
                        color: "var(--accent-green)",
                        padding: "4px 12px",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        textDecoration: "none",
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <DownloadIcon size={14} /> Download
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!searched && !loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4rem 0",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem", opacity: 0.3 }}>
              <SearchIcon size={64} />
            </div>
            <p>Enter a keyword to search across posts and files.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="fade-in" style={{ padding: "2rem" }}>
          <div className="skeleton-pulse" style={{ height: "40px", width: "200px", marginBottom: "1rem" }} />
          <div className="skeleton-pulse" style={{ height: "48px", borderRadius: "12px" }} />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
