import { cookies } from "next/headers";
import EditorPageClient, { type EditorPageInitialState } from "@/components/EditorPageClient";
import type { Category, FileRecord, PaginatedResponse, PostSummary, SearchResult } from "@/lib/api";
import { readResourceQuery, readEditorTab, toSearchParams, searchAPIParams, type ServerSearchParams } from "@/lib/resource-query";
import { requestServerJSON } from "@/lib/server-api";

export default async function EditorPage({ searchParams }: { searchParams: Promise<ServerSearchParams> }) {
  const [raw, cookieStore] = await Promise.all([searchParams, cookies()]);
  const params = toSearchParams(raw);
  const tab = readEditorTab(params);
  const postQuery = readResourceQuery(params, "posts", "post_page");
  const fileQuery = readResourceQuery(params, "files", "file_page");
  if (tab === "files") { postQuery.query = ""; postQuery.categoryId = ""; }
  else { fileQuery.query = ""; fileQuery.categoryId = ""; }
  const options = { cookieHeader: cookieStore.toString() };
  const postParams = new URLSearchParams({ page: String(postQuery.page), limit: "10", sort: "admin", ...(postQuery.categoryId ? { category_id: postQuery.categoryId } : {}) });
  const fileParams = new URLSearchParams({ page: String(fileQuery.page), limit: "10", include_system: "false" });
  const activeSearch = searchAPIParams(tab === "posts" ? postQuery : fileQuery);
  activeSearch.set("include_system", "false");
  const [categories, postResult, fileResult] = await Promise.all([
    requestServerJSON<Category[]>("/admin/categories", options),
    postQuery.query ? requestServerJSON<SearchResult>(`/admin/search?${activeSearch}`, options)
      : requestServerJSON<PaginatedResponse<PostSummary>>(`/admin/posts?${postParams}`, options),
    fileQuery.query ? requestServerJSON<SearchResult>(`/admin/search?${activeSearch}`, options)
      : requestServerJSON<PaginatedResponse<FileRecord>>(`/admin/files?${fileParams}`, options),
  ]);
  const postData = postResult.ok ? postResult.data : null;
  const fileData = fileResult.ok ? fileResult.data : null;
  const initialState: EditorPageInitialState = {
    postQuery, fileQuery,
    posts: { data: postData ? "posts" in postData ? postData.posts : postData.data : [],
      total: postData?.total || 0, page: postData?.page || postQuery.page,
      totalPages: postData ? Math.max(1, Math.ceil(postData.total / postData.limit)) : 1 },
    files: { data: fileData ? "files" in fileData ? fileData.files : fileData.data : [],
      total: fileData?.total || 0, page: fileData?.page || fileQuery.page,
      totalPages: fileData ? Math.max(1, Math.ceil(fileData.total / fileData.limit)) : 1 },
    categories: categories.ok ? categories.data : [],
    categoriesError: categories.ok ? "" : "Failed to load categories.",
    postsError: postResult.ok ? "" : "Failed to load posts.", filesError: fileResult.ok ? "" : "Failed to load files.",
  };
  return <EditorPageClient initialState={initialState} />;
}
