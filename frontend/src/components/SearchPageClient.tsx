"use client";

import { useCallback, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { PostSummary, FileRecord, Category } from "@/lib/api";
import { getCategories, searchResources, getPostTimeline } from "@/lib/api";
import Pagination from "@/components/Pagination";
import { useResourcePage } from "@/lib/use-resource-page";
import { readResourceQuery, writeResourceQuery, type ResourceQuery, type SearchScope } from "@/lib/resource-query";
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
  categoryId: string;
  scope: SearchScope;
  page: number;
  totalPages: number;
  postsTotal: number;
  filesTotal: number;
  categories: Category[];
  posts: PostSummary[];
  files: FileRecord[];
  searched: boolean;
  error: string;
}

export default function SearchPageClient({ initialState }: { initialState: SearchPageInitialState }) {
  const searchParams = useSearchParams();
  const targetQuery = useMemo(() => readResourceQuery(searchParams), [searchParams]);
  const [input, setInput] = useState({ forQuery: initialState.query, value: initialState.query });
  if (input.forQuery !== targetQuery.query) setInput({ forQuery: targetQuery.query, value: targetQuery.query });
  const query = input.value;
  function setQuery(value: string) { setInput({ forQuery: targetQuery.query, value }); }
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const load = useCallback(async (target: ResourceQuery): Promise<SearchPageInitialState> => {
    const [categories, result] = await Promise.all([getCategories(), target.query ? searchResources(target) : Promise.resolve({
      posts: [], files: [], posts_total: 0, files_total: 0, total: 0, page: 1, limit: 10,
    })]);
    return { ...target, posts: result.posts, files: result.files, categories, searched: Boolean(target.query),
      postsTotal: result.posts_total, filesTotal: result.files_total, page: result.page,
      totalPages: Math.max(1, Math.ceil(result.total / result.limit)), error: "" };
  }, []);
  const { state, loading, run, retry } = useResourcePage(initialState, initialState, targetQuery, load, "/search");
  const { posts, files, searched, error, postsTotal, filesTotal, page, totalPages, categories } = state;

  function navigate(target: ResourceQuery) {
    writeResourceQuery("/search", target, { includeScope: true });
    void run(target);
  }
  function submitSearch(value: string) {
    navigate({ ...readResourceQuery(new URLSearchParams(window.location.search)), query: value.trim(), page: 1 });
  }
  function changeFilter(patch: Partial<ResourceQuery>) {
    navigate({ ...readResourceQuery(new URLSearchParams(window.location.search)), ...patch, page: 1 });
  }
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") submitSearch(query);
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

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>Search scope <select className="resource-filter premium-select" aria-label="Search scope" value={targetQuery.scope} onChange={(event) => changeFilter({ scope: event.target.value as SearchScope })}>
          <option value="all">Posts and files</option><option value="posts">Posts</option><option value="files">Files</option>
        </select></label>
        <label>Article category <select className="resource-filter premium-select" aria-label="Search category" value={targetQuery.categoryId} onChange={(event) => changeFilter({ categoryId: event.target.value })}>
          <option value="">All categories</option><option value="0">Uncategorized</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
      </div>
      <section aria-label="Search results" aria-busy={loading}>
      {error && (
        <ErrorState
          title="Search unavailable"
          message={error}
          onRetry={() => { void retry(); }}
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
                <FileTextIcon size={16} /> Posts ({postsTotal} results)
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
                {postsTotal ? "No posts on this page. Use pagination to see the other matches." : "No matching posts found."}
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
                <FolderIcon size={16} /> Files ({filesTotal} results)
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
                {filesTotal ? "No files on this page. Use pagination to see the other matches." : "No matching files found."}
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
      {!error && searched && !loading && <Pagination currentPage={page} totalPages={totalPages} onPageChange={(next) => navigate({ ...targetQuery, page: next })} />}
      </section>

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
