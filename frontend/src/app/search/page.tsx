import SearchPageClient, { type SearchPageInitialState } from "@/components/SearchPageClient";
import type { SearchResult } from "@/lib/api";
import { requestServerJSON } from "@/lib/server-api";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadInitialState(query: string): Promise<SearchPageInitialState> {
  if (!query) {
    return { query: "", posts: [], files: [], searched: false, error: "" };
  }

  const result = await requestServerJSON<SearchResult>(
    `/search?${new URLSearchParams({ q: query, scope: "all" }).toString()}`,
  );
  if (!result.ok) {
    return { query, posts: [], files: [], searched: false, error: "Could not complete the search." };
  }
  return {
    query,
    posts: result.data.posts || [],
    files: result.data.files || [],
    searched: true,
    error: "",
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const initialState = await loadInitialState(query);

  return <SearchPageClient initialState={initialState} />;
}
