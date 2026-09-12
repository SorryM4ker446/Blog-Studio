import type { FileRecord, PostSummary, SearchResult } from "./api";
import type { ResourceQuery } from "./resource-query";
import { searchSectionQuery, type SearchQuery } from "./search-query";

export interface SearchResults extends SearchQuery {
  posts: PostSummary[];
  files: FileRecord[];
  postsTotal: number;
  filesTotal: number;
  postTotalPages: number;
  fileTotalPages: number;
}

export function emptySearchResults(query: SearchQuery): SearchResults {
  return { ...query, posts: [], files: [], postsTotal: 0, filesTotal: 0, postTotalPages: 1, fileTotalPages: 1 };
}

export async function loadSearchResults(query: SearchQuery, request: (query: ResourceQuery) => Promise<SearchResult>): Promise<SearchResults> {
  if (!query.query) return emptySearchResults(query);
  const [posts, files] = await Promise.all([
    query.scope !== "files" ? request(searchSectionQuery(query, "posts")) : null,
    query.scope !== "posts" ? request(searchSectionQuery(query, "files")) : null,
  ]);
  return { ...query, posts: posts?.posts ?? [], files: files?.files ?? [],
    postPage: posts?.page ?? 1, filePage: files?.page ?? 1,
    postsTotal: posts?.posts_total ?? 0, filesTotal: files?.files_total ?? 0,
    postTotalPages: posts ? Math.max(1, Math.ceil(posts.posts_total / posts.limit)) : 1,
    fileTotalPages: files ? Math.max(1, Math.ceil(files.files_total / files.limit)) : 1 };
}
