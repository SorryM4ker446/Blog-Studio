"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Post, FileRecord } from "@/lib/api";
import { getApiErrorMessage, searchResources, filterPostsByVisibleText, getPostTimeline } from "@/lib/api";
import FileCard from "@/components/files/FileCard";
import { FilePreviewDialog } from "@/components/files/FileDialogs";
import { 
  SearchIcon, 
  FileTextIcon, 
  FolderIcon
} from "@/components/Icons";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";

export interface SearchPageInitialState {
  query: string;
  posts: Post[];
  files: FileRecord[];
  searched: boolean;
  error: string;
}

export default function SearchPageClient({ initialState }: { initialState: SearchPageInitialState }) {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialState.query);
  const [posts, setPosts] = useState<Post[]>(initialState.posts);
  const [files, setFiles] = useState<FileRecord[]>(initialState.files);
  const [searched, setSearched] = useState(initialState.searched);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialState.error);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const searchRequestIdRef = useRef(0);
  const visibleQueryRef = useRef(initialState.query.trim());
  const retryQueryRef = useRef(initialState.query);
  const isMountedRef = useRef(true);

  const doSearch = useCallback(async (q: string) => {
    const normalizedQuery = q.trim();
    visibleQueryRef.current = normalizedQuery;
    const requestId = ++searchRequestIdRef.current;
    retryQueryRef.current = normalizedQuery;
    if (!normalizedQuery) {
      setPosts([]);
      setFiles([]);
      setSearched(false);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await searchResources(normalizedQuery);
      if (!isMountedRef.current || requestId !== searchRequestIdRef.current) return;
      setPosts(filterPostsByVisibleText(result.posts, normalizedQuery));
      setFiles(result.files);
      setSearched(true);
    } catch (requestError) {
      if (!isMountedRef.current || requestId !== searchRequestIdRef.current) return;
      setSearched(false);
      setError(getApiErrorMessage(requestError, "Could not complete the search."));
    } finally {
      if (isMountedRef.current && requestId === searchRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  function submitSearch(value: string) {
    const normalizedQuery = value.trim();
    const currentQuery = new URLSearchParams(window.location.search).get("q")?.trim() || "";
    if (normalizedQuery === currentQuery) {
      void doSearch(normalizedQuery);
      return;
    }
    window.history.pushState(
      null,
      "",
      normalizedQuery ? `/search?q=${encodeURIComponent(normalizedQuery)}` : "/search",
    );
    void doSearch(normalizedQuery);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const normalizedURLQuery = urlQuery.trim();
    if (visibleQueryRef.current === normalizedURLQuery) return;
    setQuery(urlQuery);
    void doSearch(urlQuery);
  }, [doSearch, urlQuery]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      submitSearch(query);
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
          aria-label="Search posts and files"
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
          onClick={() => submitSearch(query)}
          disabled={loading}
          aria-busy={loading}
          style={{
            background: "var(--accent-blue)",
            color: "var(--accent-contrast-text)",
            border: "none",
            borderRadius: "12px",
            padding: "0 1.5rem",
            fontSize: "0.9rem",
            fontWeight: 500,
            cursor: loading ? "wait" : "pointer",
            transition: "opacity 0.2s",
            opacity: loading ? 0.7 : 1,
          }}
        >
          Search
        </button>
      </div>

      <section aria-label="Search results" aria-busy={loading}>
      {error && (
        <ErrorState
          title="Search unavailable"
          message={error}
          onRetry={() => { void doSearch(retryQueryRef.current); }}
          retrying={loading}
        />
      )}

      {!error && loading && (
        <LoadingState label="Searching posts and files…" rows={2} />
      )}

      {!error && searched && !loading && (
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
                          {getPostTimeline(post).label} on{" "}
                          {new Date(getPostTimeline(post).timestamp).toLocaleDateString()} •{" "}
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
                  <FileCard
                    key={file.id}
                    file={file}
                    onPreview={setPreviewFile}
                    showDescription={false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!error && !searched && !loading && (
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
      </section>

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
