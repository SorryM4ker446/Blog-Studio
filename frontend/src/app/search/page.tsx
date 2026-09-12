import SearchPageClient, { type SearchPageInitialState } from "@/components/SearchPageClient";
import type { Category, SearchResult } from "@/lib/api";
import { toSearchParams, searchAPIParams, type ServerSearchParams } from "@/lib/resource-query";
import { readSearchQuery } from "@/lib/search-query";
import { emptySearchResults, loadSearchResults } from "@/lib/search-results";
import { requestServerJSON } from "@/lib/server-api";

export default async function SearchPage({ searchParams }: { searchParams: Promise<ServerSearchParams> }) {
  const target = readSearchQuery(toSearchParams(await searchParams));
  const [categories, result] = await Promise.all([
    requestServerJSON<Category[]>("/categories"),
    loadSearchResults(target, async query => {
      const response = await requestServerJSON<SearchResult>(`/search?${searchAPIParams(query)}`);
      if (!response.ok) throw new Error("Could not complete the search.");
      return response.data;
    }).then(data => ({ data, error: "" }), () => ({ data: emptySearchResults(target), error: "Could not complete the search." })),
  ]);
  const initialState: SearchPageInitialState = {
    ...result.data, categories: categories.ok ? categories.data : [],
    searched: Boolean(target.query && !result.error),
    error: !categories.ok ? "Could not load search categories." : result.error,
  };
  return <SearchPageClient initialState={initialState} />;
}
