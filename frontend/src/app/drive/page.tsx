import DrivePageClient, { type DrivePageInitialState } from "@/components/DrivePageClient";
import type { FileRecord, PaginatedResponse, SearchResult } from "@/lib/api";
import { readResourceQuery, toSearchParams, searchAPIParams } from "@/lib/resource-query";
import { requestServerJSON } from "@/lib/server-api";

interface DrivePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadInitialState(query: string, page: number): Promise<DrivePageInitialState> {
  const result = query
    ? await requestServerJSON<SearchResult>(`/search?${searchAPIParams({ query, categoryId: "", page, scope: "files" })}`)
    : await requestServerJSON<PaginatedResponse<FileRecord>>(`/files?${new URLSearchParams({
        page: page.toString(),
        limit: "10",
      }).toString()}`);

  if (!result.ok) {
    return { query, files: [], page, totalPages: 1, error: "Could not load files." };
  }
  if (query) {
    const searchResult = result.data as SearchResult;
    return { query, files: searchResult.files || [], page: searchResult.page, totalPages: Math.max(1, Math.ceil(searchResult.files_total / searchResult.limit)), error: "" };
  }
  const pageResult = result.data as PaginatedResponse<FileRecord>;
  return {
    query,
    files: Array.isArray(pageResult.data) ? pageResult.data : [],
    page: pageResult.page || page,
    totalPages: Math.max(1, Math.ceil(pageResult.total / pageResult.limit)),
    error: Array.isArray(pageResult.data) ? "" : "Could not load files.",
  };
}

export default async function DrivePage({ searchParams }: DrivePageProps) {
  const params = await searchParams;
  const { query, page } = readResourceQuery(toSearchParams(params), "files");
  const initialState = await loadInitialState(query, page);

  return <DrivePageClient initialState={initialState} />;
}
