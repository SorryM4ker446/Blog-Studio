"use client";

import { formatDate } from "@/lib/display-date";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPostTimeline, getPosts, searchResources, getCategories } from "@/lib/api";
import type { PostSummary } from "@/lib/api";
import Link from "next/link";
import { readResourceQuery, writeResourceQuery, type ResourceQuery } from "@/lib/resource-query";
import { useResourcePage } from "@/lib/use-resource-page";
import SearchInput from "@/components/SearchInput";
import PaginatedResults from "@/components/PaginatedResults";
import ListPending from "@/components/ListPending";
import { FolderIcon, ClipboardIcon, InboxIcon, FileTextIcon } from "@/components/Icons";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";

export interface PostsPageInitialState {
  query: string;
  categoryId: string;
  posts: PostSummary[];
  page: number;
  totalPages: number;
  currentCategoryName: string | null;
  error: string;
}

export default function PostsPageClient({ initialState }: { initialState: PostsPageInitialState }) {
  const [animateChanges, setAnimateChanges] = useState(false);
  const searchParams = useSearchParams();
  const query = useMemo(() => readResourceQuery(searchParams, "posts"), [searchParams]);
  const searchQuery = query.query;
  const load = useCallback(async (target: ResourceQuery): Promise<PostsPageInitialState> => {
    const [categories, result] = await Promise.all([
      target.categoryId ? getCategories() : Promise.resolve([]),
      target.query ? searchResources(target) : getPosts(target.page, 10, target.categoryId),
    ]);
    const total = "posts_total" in result ? result.posts_total : result.total;
    return { query: target.query, categoryId: target.categoryId, posts: "posts" in result ? result.posts : result.data,
      page: result.page, totalPages: Math.max(1, Math.ceil(total / result.limit)),
      currentCategoryName: target.categoryId === "0" ? "Uncategorized" : categories.find((item) => String(item.id) === target.categoryId)?.name || null, error: "" };
  }, []);
  const { state, loading, restoring, run, retry: retryLastRequest } = useResourcePage(
    initialState, { query: initialState.query, categoryId: initialState.categoryId, scope: "posts", page: initialState.page }, query, load, "/posts", "page", true, "public",
  );
  const { posts, error, page, totalPages, currentCategoryName } = state;

  function handleSearch(value: string) {
    setAnimateChanges(true);
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "posts"), query: value.trim(), page: 1 };
    writeResourceQuery("/posts", target);
    void run(target);
  }
  function handlePageChange(page: number) {
    setAnimateChanges(true);
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "posts"), page };
    writeResourceQuery("/posts", target);
    void run(target);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            {currentCategoryName ? (
              <>
                <FolderIcon size={28} />
                {currentCategoryName}
              </>
            ) : (
              <>
                <ClipboardIcon size={28} style={{ color: "var(--text-primary)" }} />
                {query.categoryId ? "Category articles" : "All Posts"}
              </>
            )}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: 0 }}>
            {currentCategoryName 
              ? `Browsing articles in the ${currentCategoryName} category.` 
              : "Browse all published articles across every category."
            }
          </p>
        </div>
        <SearchInput
          placeholder="Search posts..."
          onSearch={handleSearch}
          style={{ width: "250px" }}
          value={searchQuery}
        />
      </div>

      <section aria-label="Posts" aria-busy={loading}>
      {error ? (
        <ErrorState message={error} onRetry={retryLastRequest} retrying={loading} />
      ) : restoring ? (
        <PaginatedResults page={query.page} totalPages={Math.max(query.page, totalPages)} pending animateChanges={false}
          resultKey={JSON.stringify([query.query, query.categoryId, query.page])} onPageChange={handlePageChange}>
          <ListPending label="Loading posts…" />
        </PaginatedResults>
      ) : (
        <PaginatedResults page={page} totalPages={totalPages} pending={loading} animateChanges={animateChanges}
          resultKey={JSON.stringify([state.query, state.categoryId, page])} onPageChange={handlePageChange}>
        {posts.length === 0 ? (
        <EmptyState
          title={state.query ? "No matching posts" : "No posts yet"}
          message={state.query
            ? `No posts match “${state.query}”. Try another keyword.`
            : currentCategoryName
              ? `There are no published posts in ${currentCategoryName}.`
              : "No published posts are available yet."}
          icon={<InboxIcon size={48} />}
        />
        ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          {posts.map((post: PostSummary) => (
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
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    color: "var(--text-secondary)",
                    marginRight: "1.2rem",
                    flexShrink: 0,
                  }}
                >
                  <FileTextIcon size={14} />
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
                  {post.summary && (
                    <div
                      style={{
                        fontSize: "0.9rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.4rem",
                        lineHeight: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}
                    >
                      {post.summary}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--text-muted)",
                      marginTop: post.summary ? "0.6rem" : "0.3rem",
                      display: "flex",
                      gap: "0.8rem",
                      flexWrap: "wrap",
                      alignItems: "center"
                    }}
                    >
                      <span>
                      {getPostTimeline(post).label} on{" "}
                      {formatDate(getPostTimeline(post).timestamp)}
                    </span>
                    <span
                      style={{
                        background: post.category_id == null ? "rgba(128,128,128,0.15)" : "rgba(109, 214, 140, 0.12)",
                        color: post.category_id == null ? "var(--text-muted)" : "var(--accent-green)",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {post.category_id == null ? "无标签" : (post.category ? post.category.name : "Uncategorized")}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
        )}
        </PaginatedResults>
      )}
      </section>

    </div>
  );
}
