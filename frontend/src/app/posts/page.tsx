import PostsPageClient, { type PostsPageInitialState } from "@/components/PostsPageClient";
import type { Category, PaginatedResponse, Post, SearchResult } from "@/lib/api";
import { requestServerJSON } from "@/lib/server-api";

interface PostsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function readPage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function loadInitialState(query: string, categoryId: string, page: number): Promise<PostsPageInitialState> {
  const categoryPromise = categoryId
    ? requestServerJSON<Category[]>("/categories")
    : Promise.resolve(null);
  const dataPromise = query
    ? requestServerJSON<SearchResult>(`/search?${new URLSearchParams({
        q: query,
        scope: "posts",
        ...(categoryId ? { category_id: categoryId } : {}),
      }).toString()}`)
    : requestServerJSON<PaginatedResponse<Post>>(`/posts?${new URLSearchParams({
        page: page.toString(),
        limit: "10",
        ...(categoryId ? { category_id: categoryId } : {}),
      }).toString()}`);
  const [dataResult, categoryResult] = await Promise.all([dataPromise, categoryPromise]);

  const currentCategoryName = categoryResult?.ok
    ? categoryResult.data.find((category) => category.id.toString() === categoryId)?.name || null
    : null;

  if (!dataResult.ok) {
    return { query, posts: [], page, totalPages: 1, currentCategoryName, error: "Could not load posts." };
  }
  if (query) {
    const result = dataResult.data as SearchResult;
    return { query, posts: result.posts || [], page: 1, totalPages: 1, currentCategoryName, error: "" };
  }
  const result = dataResult.data as PaginatedResponse<Post>;
  return {
    query,
    posts: Array.isArray(result.data) ? result.data : [],
    page: result.page || page,
    totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
    currentCategoryName,
    error: Array.isArray(result.data) ? "" : "Could not load posts.",
  };
}

export default async function AllPostsPage({ searchParams }: PostsPageProps) {
  const params = await searchParams;
  const query = readParam(params.q).trim();
  const categoryId = readParam(params.category);
  const page = readPage(readParam(params.page));
  const initialState = await loadInitialState(query, categoryId, page);

  return (
    <PostsPageClient
      key={categoryId || "all"}
      initialState={initialState}
    />
  );
}
