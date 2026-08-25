"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { getApiErrorMessage, getPostTimeline, getPosts, searchResources, getCategories } from "@/lib/api";
import type { Post } from "@/lib/api";
import Link from "next/link";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import { FolderIcon, ClipboardIcon, InboxIcon, FileTextIcon } from "@/components/Icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AsyncState";

export interface PostsPageInitialState {
  query: string;
  posts: Post[];
  page: number;
  totalPages: number;
  currentCategoryName: string | null;
  error: string;
}

export default function PostsPageClient({ initialState }: { initialState: PostsPageInitialState }) {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get("category");
  const searchQuery = searchParams.get("q") || "";

  const [posts, setPosts] = useState<Post[]>(initialState.posts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialState.error);
  const [page, setPage] = useState(initialState.page);
  const [totalPages, setTotalPages] = useState(initialState.totalPages);
  const [currentCategoryName, setCurrentCategoryName] = useState<string | null>(initialState.currentCategoryName);
  const requestIdRef = useRef(0);
  const visibleQueryRef = useRef(initialState.query.trim());
  const visiblePageRef = useRef(initialState.page);
  const defaultSnapshotRef = useRef<PostsPageInitialState | null>(initialState.query.trim() ? null : initialState);
  const retryRequestRef = useRef<
    | { type: "page"; page: number; categoryId: string }
    | { type: "search"; query: string; categoryId: string }
  >(searchQuery.trim()
    ? { type: "search", query: searchQuery.trim(), categoryId: categoryId || "" }
    : { type: "page", page: initialState.page, categoryId: categoryId || "" });

  const loadPosts = useCallback(async (pageToLoad: number, catId: string = categoryId || "") => {
    visibleQueryRef.current = "";
    visiblePageRef.current = pageToLoad;
    const requestId = ++requestIdRef.current;
    retryRequestRef.current = { type: "page", page: pageToLoad, categoryId: catId };
    setLoading(true);
    setError("");
    try {
      const result = await getPosts(pageToLoad, 10, false, "", catId);
      if (result.error) throw new Error(result.error);
      if (requestId !== requestIdRef.current) return;
      const nextPage = result.page;
      const nextTotalPages = Math.max(1, Math.ceil(result.total / result.limit));
      let nextCategoryName: string | null = null;

      if (catId) {
        const cats = await getCategories();
        if (requestId !== requestIdRef.current) return;
        const cat = cats.find((item) => item.id.toString() === catId);
        nextCategoryName = cat ? cat.name : null;
      }
      setPosts(result.data);
      setPage(nextPage);
      setTotalPages(nextTotalPages);
      setCurrentCategoryName(nextCategoryName);
      defaultSnapshotRef.current = {
        query: "",
        posts: result.data,
        page: nextPage,
        totalPages: nextTotalPages,
        currentCategoryName: nextCategoryName,
        error: "",
      };
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not load posts."));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [categoryId]);

  const searchPosts = useCallback(async (query: string, catId: string = categoryId || "") => {
    visibleQueryRef.current = query;
    visiblePageRef.current = 1;
    const requestId = ++requestIdRef.current;
    retryRequestRef.current = { type: "search", query, categoryId: catId };
    setLoading(true);
    setError("");
    try {
      const res = await searchResources(query, "posts", catId);
      if (requestId !== requestIdRef.current) return;
      setPosts(res.posts || []);
      setPage(1);
      setTotalPages(1);
      if (catId) {
        const cats = await getCategories();
        if (requestId !== requestIdRef.current) return;
        const category = cats.find((item) => item.id.toString() === catId);
        setCurrentCategoryName(category ? category.name : null);
      } else {
        setCurrentCategoryName(null);
      }
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(requestError, "Could not search posts."));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [categoryId]);

  function retryLastRequest() {
    const request = retryRequestRef.current;
    if (request.type === "search") {
      void searchPosts(request.query, request.categoryId);
    } else {
      void loadPosts(request.page, request.categoryId);
    }
  }

  function handleSearch(query: string) {
    const params = new URLSearchParams(window.location.search);
    const normalizedQuery = query.trim();
    const currentQuery = params.get("q")?.trim() || "";
    const currentCategoryId = params.get("category") || "";
    if (normalizedQuery === currentQuery) {
      if (normalizedQuery) void searchPosts(normalizedQuery, currentCategoryId);
      else void loadPosts(page, currentCategoryId);
      return;
    }
    if (normalizedQuery) {
      params.set("q", normalizedQuery);
    } else {
      params.delete("q");
    }
    const nextQuery = params.toString();
    window.history.pushState(null, "", nextQuery ? `/posts?${nextQuery}` : "/posts");
    if (normalizedQuery) {
      void searchPosts(normalizedQuery, currentCategoryId);
    } else {
      const snapshot = defaultSnapshotRef.current;
      if (snapshot) {
        setPosts(snapshot.posts);
        setPage(snapshot.page);
        setTotalPages(snapshot.totalPages);
        setCurrentCategoryName(snapshot.currentCategoryName);
      }
      void loadPosts(snapshot?.page || 1, currentCategoryId);
    }
  }

  function handlePageChange(nextPage: number) {
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.set("page", nextPage.toString());
    window.history.pushState(null, "", `/posts?${params.toString()}`);
    void loadPosts(nextPage, params.get("category") || "");
  }

  useEffect(() => {
    const query = searchQuery.trim();
    const parsedPage = Number.parseInt(searchParams.get("page") || "1", 10);
    const targetPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const catId = categoryId || "";
    if (query) {
      if (visibleQueryRef.current !== query) void searchPosts(query, catId);
      return;
    }
    if (visibleQueryRef.current || visiblePageRef.current !== targetPage) {
      const snapshot = defaultSnapshotRef.current;
      if (snapshot) {
        setPosts(snapshot.posts);
        setPage(snapshot.page);
        setTotalPages(snapshot.totalPages);
        setCurrentCategoryName(snapshot.currentCategoryName);
      }
      void loadPosts(targetPage, catId);
    }
  }, [categoryId, loadPosts, searchParams, searchPosts, searchQuery]);

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
                All Posts
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
      ) : loading && posts.length === 0 ? (
        <LoadingState label={searchQuery ? "Searching posts…" : "Loading posts…"} />
      ) : posts.length === 0 ? (
        <EmptyState
          title={searchQuery ? "No matching posts" : "No posts yet"}
          message={searchQuery
            ? `No posts match “${searchQuery}”. Try another keyword.`
            : currentCategoryName
              ? `There are no published posts in ${currentCategoryName}.`
              : "No published posts are available yet."}
          icon={<InboxIcon size={48} />}
        />
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
                      {new Date(getPostTimeline(post).timestamp).toLocaleDateString()}
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
      </section>

      {/* Pagination component */}
      {!error && !loading && posts.length > 0 && (
        <Pagination 
          currentPage={page} 
          totalPages={totalPages} 
          onPageChange={handlePageChange}
        />
      )}

    </div>
  );
}
