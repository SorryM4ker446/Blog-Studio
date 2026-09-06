import PostsPageClient, { type PostsPageInitialState } from "@/components/PostsPageClient";
import type { Category, PaginatedResponse, PostSummary, SearchResult } from "@/lib/api";
import { readResourceQuery, toSearchParams, searchAPIParams } from "@/lib/resource-query";
import { requestServerJSON } from "@/lib/server-api";

interface PostsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadInitialState(query: string, categoryId: string, page: number): Promise<PostsPageInitialState> {
  const categoryPromise = categoryId
    ? requestServerJSON<Category[]>("/categories")
    : Promise.resolve(null);
  const dataPromise = query
    ? requestServerJSON<SearchResult>(`/search?${searchAPIParams({ query, categoryId, page, scope: "posts" })}`)
    : requestServerJSON<PaginatedResponse<PostSummary>>(`/posts?${new URLSearchParams({
        page: page.toString(),
        limit: "10",
        ...(categoryId ? { category_id: categoryId } : {}),
      }).toString()}`);
  const [dataResult, categoryResult] = await Promise.all([dataPromise, categoryPromise]);

  const currentCategoryName = categoryResult?.ok
    ? categoryResult.data.find((category) => category.id.toString() === categoryId)?.name || null
    : null;

  if (!dataResult.ok) {
    return { query, categoryId, posts: [], page, totalPages: 1, currentCategoryName, error: "Could not load posts." };
  }
  if (query) {
    const result = dataResult.data as SearchResult;
    return { query, categoryId, posts: result.posts || [], page: result.page, totalPages: Math.max(1, Math.ceil(result.posts_total / result.limit)), currentCategoryName, error: "" };
  }
  const result = dataResult.data as PaginatedResponse<PostSummary>;
  return {
    query,
    categoryId,
    posts: Array.isArray(result.data) ? result.data : [],
    page: result.page || page,
    totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
    currentCategoryName,
    error: Array.isArray(result.data) ? "" : "Could not load posts.",
  };
}

export default async function AllPostsPage({ searchParams }: PostsPageProps) {
  const params = await searchParams;
  const { query, categoryId, page } = readResourceQuery(toSearchParams(params), "posts");
  const initialState = await loadInitialState(query, categoryId, page);

  return (
    <PostsPageClient
      initialState={initialState}
    />
  );
}
