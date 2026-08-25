import { cookies } from "next/headers";
import EditorPageClient, {
  type EditorPageInitialState,
  type FileListSnapshot,
  type PostListSnapshot,
} from "@/components/EditorPageClient";
import { filterPostsByVisibleText } from "@/lib/api";
import type { Category, FileRecord, PaginatedResponse, Post, SearchResult } from "@/lib/api";
import { requestServerJSON } from "@/lib/server-api";

interface EditorPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function postSnapshot(result?: PaginatedResponse<Post>): PostListSnapshot {
  return {
    data: Array.isArray(result?.data) ? result.data : [],
    page: result?.page || 1,
    totalPages: result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1,
    total: result?.total || 0,
  };
}

function fileSnapshot(result?: PaginatedResponse<FileRecord>): FileListSnapshot {
  return {
    data: Array.isArray(result?.data) ? result.data : [],
    page: result?.page || 1,
    totalPages: result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1,
    total: result?.total || 0,
  };
}

async function loadInitialState(
  cookieHeader: string,
  tab: "posts" | "files",
  query: string,
  postPage: number,
  filePage: number,
): Promise<EditorPageInitialState> {
  const requestOptions = { cookieHeader };
  const [categoryResult, postResult, fileResult, searchResult] = await Promise.all([
    requestServerJSON<Category[]>("/admin/categories", requestOptions),
    requestServerJSON<PaginatedResponse<Post>>(`/admin/posts?${new URLSearchParams({
      page: postPage.toString(),
      limit: "10",
      sort: "admin",
    }).toString()}`, requestOptions),
    requestServerJSON<PaginatedResponse<FileRecord>>(`/admin/files?${new URLSearchParams({
      page: filePage.toString(),
      limit: "10",
      include_system: "false",
    }).toString()}`, requestOptions),
    query
      ? requestServerJSON<SearchResult>(`/admin/search?${new URLSearchParams({
          q: query,
          scope: tab,
          include_system: "false",
        }).toString()}`, requestOptions)
      : Promise.resolve(null),
  ]);

  const defaultPosts = postSnapshot(postResult.ok ? postResult.data : undefined);
  const defaultFiles = fileSnapshot(fileResult.ok ? fileResult.data : undefined);
  let visiblePosts = defaultPosts;
  let visibleFiles = defaultFiles;

  if (query && searchResult?.ok) {
    if (tab === "posts") {
      const posts = filterPostsByVisibleText(searchResult.data.posts || [], query);
      visiblePosts = { data: posts, page: 1, totalPages: 1, total: posts.length };
    } else {
      const files = searchResult.data.files || [];
      visibleFiles = { data: files, page: 1, totalPages: 1, total: files.length };
    }
  }

  return {
    posts: visiblePosts,
    files: visibleFiles,
    postDefault: defaultPosts,
    fileDefault: defaultFiles,
    categories: categoryResult.ok ? categoryResult.data : [],
    postsError: query && tab === "posts"
      ? searchResult?.ok ? "" : "Failed to search posts."
      : postResult.ok ? "" : "Failed to load posts.",
    filesError: query && tab === "files"
      ? searchResult?.ok ? "" : "Failed to search files."
      : fileResult.ok ? "" : "Failed to load files.",
    categoriesError: categoryResult.ok ? "" : "Failed to load categories.",
    postViewQuery: query && tab === "posts" ? query : null,
    fileViewQuery: query && tab === "files" ? query : null,
  };
}

export default async function EditorPage({ searchParams }: EditorPageProps) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const tab = params.tab === "files" ? "files" : "posts";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const readPage = (value: string | string[] | undefined) => {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : 1;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  };
  const postPage = readPage(params.post_page);
  const filePage = readPage(params.file_page);
  const initialState = await loadInitialState(cookieStore.toString(), tab, query, postPage, filePage);

  return <EditorPageClient initialState={initialState} />;
}
