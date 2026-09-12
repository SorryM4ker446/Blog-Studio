"use client";

import { formatDate } from "@/lib/display-date";

import { useCallback, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { FileRecord, Category } from "@/lib/api";
import { getCategories, searchResources, getPostTimeline } from "@/lib/api";
import PaginatedResults from "@/components/PaginatedResults";
import { useSearchPage } from "@/lib/use-search-page";
import { useScopeTransition } from "@/lib/use-scope-transition";
import { loadSearchResults, type SearchResults } from "@/lib/search-results";
import { readSearchQuery, writeSearchQuery, type SearchQuery } from "@/lib/search-query";
import type { SearchScope } from "@/lib/resource-query";
import FileCard from "@/components/files/FileCard";
import { FilePreviewDialog } from "@/components/files/FileDialogs";
import { 
  SearchIcon, 
  FileTextIcon, 
  FolderIcon
} from "@/components/Icons";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";
import EditorSelect from "@/components/editor/EditorSelect";
import styles from "./SearchPageClient.module.css";

export interface SearchPageInitialState extends SearchResults {
  categories: Category[];
  searched: boolean;
  error: string;
}

export default function SearchPageClient({ initialState }: { initialState: SearchPageInitialState }) {
  const searchParams = useSearchParams();
  const targetQuery = useMemo(() => readSearchQuery(searchParams), [searchParams]);
  const [input, setInput] = useState({ forQuery: initialState.query, value: initialState.query });
  if (input.forQuery !== targetQuery.query) setInput({ forQuery: targetQuery.query, value: targetQuery.query });
  const query = input.value;
  function setQuery(value: string) { setInput({ forQuery: targetQuery.query, value }); }
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const load = useCallback(async (target: SearchQuery): Promise<SearchPageInitialState> => {
    const [categories, result] = await Promise.all([getCategories(), loadSearchResults(target, searchResources)]);
    return { ...result, categories, searched: Boolean(target.query), error: "" };
  }, []);
  const { state, loading, run, retry } = useSearchPage(initialState, targetQuery, load);
  const { displayed, ref: resultsRef, changing: changingScope } = useScopeTransition(state, targetQuery.scope, loading);
  const { posts, files, searched, error, postsTotal, filesTotal, postPage, filePage, postTotalPages, fileTotalPages } = displayed;
  const { categories } = state;
  const visibleCategories = useMemo(
    () => categories.filter((category) => category.post_count === undefined || category.post_count > 0),
    [categories],
  );

  function navigate(target: SearchQuery) {
    writeSearchQuery(target);
    void run(target);
  }
  function submitSearch(value: string) {
    navigate({ ...readSearchQuery(new URLSearchParams(window.location.search)), query: value.trim(), postPage: 1, filePage: 1 });
  }
  function changeFilter(patch: Partial<SearchQuery>) {
    const target = { ...readSearchQuery(new URLSearchParams(window.location.search)), ...patch, postPage: 1, filePage: 1 };
    if (target.scope !== "posts") target.categoryId = "";
    navigate(target);
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
          }}
        >
          Search
        </button>
      </div>

      <div className="search-filters">
        <div className="search-filter-field">
          <span>Search scope</span>
          <EditorSelect
            ariaLabel="Search scope"
            value={targetQuery.scope}
            width="13rem"
            options={[
              { value: "all" as SearchScope, label: "Posts and files" },
              { value: "posts" as SearchScope, label: "Posts" },
              { value: "files" as SearchScope, label: "Files" },
            ]}
            onChange={(scope) => changeFilter({ scope })}
          />
        </div>
        {targetQuery.scope === "posts" && <div className={`search-filter-field ${styles.categoryReveal}`}>
          <span>Article category</span>
          <EditorSelect
            ariaLabel="Search category"
            unavailableLabel="Unavailable category"
            value={targetQuery.categoryId}
            width="15rem"
            options={[
              { value: "", label: "All categories" },
              { value: "0", label: "Uncategorized" },
              ...visibleCategories.map((category) => ({ value: String(category.id), label: category.name })),
            ]}
            onChange={(categoryId) => changeFilter({ categoryId })}
          />
        </div>}
      </div>
      <section ref={resultsRef} aria-label="Search results" aria-busy={loading || changingScope} inert={changingScope}>
      {error && (
        <ErrorState
          title="Search unavailable"
          message={error}
          onRetry={() => { void retry(); }}
          retrying={loading}
        />
      )}

      {!error && loading && !searched && targetQuery.query && (
        <LoadingState label="Searching posts and files…" rows={2} />
      )}

      {!error && searched && (
        <div>
          {loading && (
            <span className="sr-only" role="status" aria-label="Updating search results…">
              Updating search results…
            </span>
          )}
          {/* 文章结果 */}
          {displayed.scope !== "files" && <section aria-label="Post results" style={{ marginBottom: "2rem" }}>
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
            <PaginatedResults page={postPage} totalPages={postTotalPages} pending={loading} edgeArrows
              transitionGroup={displayed.scope}
              resultKey={JSON.stringify([displayed.query, displayed.categoryId, postPage])} onPageChange={(next) => navigate({ ...targetQuery, postPage: next })}>
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
                          {formatDate(getPostTimeline(post).timestamp)} •{" "}
                          {post.category?.name || "Uncategorized"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            </PaginatedResults>
          </section>}

          {/* 文件结果 */}
          {displayed.scope !== "posts" && <section aria-label="File results">
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
            <PaginatedResults page={filePage} totalPages={fileTotalPages} pending={loading} edgeArrows
              transitionGroup={displayed.scope}
              resultKey={JSON.stringify([displayed.query, filePage])} onPageChange={(next) => navigate({ ...targetQuery, filePage: next })}>
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
            </PaginatedResults>
          </section>}
        </div>
      )}

      {!error && !searched && (!loading || !targetQuery.query) && (
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
