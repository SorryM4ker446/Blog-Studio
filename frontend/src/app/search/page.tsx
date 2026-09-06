import SearchPageClient, { type SearchPageInitialState } from "@/components/SearchPageClient";
import type { Category, SearchResult } from "@/lib/api";
import { readResourceQuery, toSearchParams, searchAPIParams, type ServerSearchParams } from "@/lib/resource-query";
import { requestServerJSON } from "@/lib/server-api";

export default async function SearchPage({ searchParams }: { searchParams: Promise<ServerSearchParams> }) {
  const target = readResourceQuery(toSearchParams(await searchParams));
  const [categories, result] = await Promise.all([
    requestServerJSON<Category[]>("/categories"),
    target.query ? requestServerJSON<SearchResult>(`/search?${searchAPIParams(target)}`) : Promise.resolve(null),
  ]);
  const initialState: SearchPageInitialState = {
    ...target, posts: result?.ok ? result.data.posts : [], files: result?.ok ? result.data.files : [],
    page: result?.ok ? result.data.page : target.page,
    totalPages: result?.ok ? Math.max(1, Math.ceil(result.data.total / result.data.limit)) : 1,
    postsTotal: result?.ok ? result.data.posts_total : 0, filesTotal: result?.ok ? result.data.files_total : 0,
    categories: categories.ok ? categories.data : [], searched: Boolean(target.query && result?.ok),
    error: !categories.ok ? "Could not load search categories." : target.query && !result?.ok ? "Could not complete the search." : "",
  };
  return <SearchPageClient initialState={initialState} />;
}
