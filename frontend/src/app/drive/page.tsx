import DrivePageClient, { type DrivePageInitialState } from "@/components/DrivePageClient";
import type { FileRecord, PaginatedResponse, SearchResult } from "@/lib/api";
import { requestServerJSON } from "@/lib/server-api";

interface DrivePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function readPage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function loadInitialState(query: string, page: number): Promise<DrivePageInitialState> {
  const result = query
    ? await requestServerJSON<SearchResult>(`/search?${new URLSearchParams({ q: query, scope: "files" }).toString()}`)
    : await requestServerJSON<PaginatedResponse<FileRecord>>(`/files?${new URLSearchParams({
        page: page.toString(),
        limit: "10",
      }).toString()}`);

  if (!result.ok) {
    return { query, files: [], page, totalPages: 1, error: "Could not load files." };
  }
  if (query) {
    const searchResult = result.data as SearchResult;
    return { query, files: searchResult.files || [], page: 1, totalPages: 1, error: "" };
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
  const query = readParam(params.q).trim();
  const page = readPage(readParam(params.page));
  const initialState = await loadInitialState(query, page);

  return <DrivePageClient initialState={initialState} />;
}
