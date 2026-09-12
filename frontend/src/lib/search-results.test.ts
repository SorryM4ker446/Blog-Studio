import { describe, expect, it, vi } from "vitest";
import { loadSearchResults } from "./search-results";
import { readSearchQuery } from "./search-query";
import type { FileRecord, PostSummary, SearchResult } from "./api";
import type { ResourceQuery } from "./resource-query";

const query = readSearchQuery(new URLSearchParams("q=needle&category=2&post_page=2&file_page=3"));
const response = (q: ResourceQuery): SearchResult => ({ posts: q.scope === "posts" ? Array.from({ length: 10 }, (_, id) => ({ id }) as PostSummary) : [],
  files: q.scope === "files" ? Array.from({ length: 10 }, (_, id) => ({ id }) as FileRecord) : [],
  posts_total: q.scope === "posts" ? 25 : 0, files_total: q.scope === "files" ? 32 : 0, total: q.scope === "posts" ? 25 : 32, page: q.page, limit: 10 });

describe("grouped search loading", () => {
  it("requests ten results of each kind concurrently and retains separate totals and pages", async () => {
    const request = vi.fn(async (q: ResourceQuery) => response(q));
    const result = await loadSearchResults(query, request);
    expect(request.mock.calls.map(([q]) => q)).toEqual([
      { query: "needle", categoryId: "", scope: "posts", page: 2 },
      { query: "needle", categoryId: "", scope: "files", page: 3 },
    ]);
    expect(result.posts).toHaveLength(10); expect(result.files).toHaveLength(10);
    expect(result).toMatchObject({ postsTotal: 25, filesTotal: 32, postTotalPages: 3, fileTotalPages: 4, postPage: 2, filePage: 3 });
  });
  it.each(["posts", "files"] as const)("only requests the selected %s scope", async scope => {
    const request = vi.fn(async (q: ResourceQuery) => response(q));
    const result = await loadSearchResults({ ...query, scope }, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].scope).toBe(scope);
    expect(result[scope === "posts" ? "files" : "posts"]).toEqual([]);
  });
  it("does not request an empty query or silently turn failed sections into zero matches", async () => {
    const request = vi.fn().mockRejectedValue(new Error("offline"));
    expect((await loadSearchResults({ ...query, query: "" }, request)).posts).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    await expect(loadSearchResults(query, request)).rejects.toThrow("offline");
  });
});
