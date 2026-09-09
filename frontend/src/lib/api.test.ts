import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdminPost,
  searchResources,
  searchAdminResources,
  getPostTimeline,
  logoutUser,
  normalizeFileViewUrl,
  normalizeMarkdownFileUrls,
  type PostSummary,
} from "./api";
import { clearCSRFToken, setCSRFToken } from "./api-client";
import { rebaseFileViewURLs } from "./file-url";

describe("paginated search requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends public filters and combined pagination without credentials", async () => {
    const payload = { posts: [], files: [], posts_total: 3, files_total: 2, total: 5, page: 2, limit: 3 };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload)); vi.stubGlobal("fetch", fetchMock);
    await expect(searchResources({query:"a%b 中", scope:"all", categoryId:"0", page:2}, 3)).resolves.toEqual(payload);
    const [url, options] = fetchMock.mock.calls[0];
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({q:"a%b 中", scope:"all", category_id:"0", page:"2", limit:"3"});
    expect(options).toMatchObject({credentials:"omit"});
  });
  it("keeps administrator search private with explicit system-file selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({posts:[], files:[], total:0, posts_total:0, files_total:0, page:1, limit:10}));
    vi.stubGlobal("fetch", fetchMock);
    await searchAdminResources({query:"file", scope:"files", categoryId:"", page:1}, false);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/admin/search");
    expect(new URL(url).searchParams.get("include_system")).toBe("false");
    expect(options).toMatchObject({credentials:"include", cache:"no-store"});
  });
});

describe("administrator article detail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests complete content with the session, no-store and cancellation signal", async () => {
    const post = { ...makePost(), version: 1, content: "Complete article body" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(post));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getAdminPost(1, { signal: controller.signal })).resolves.toEqual(post);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/admin/posts/1", expect.objectContaining({
      credentials: "include", cache: "no-store", signal: controller.signal,
    }));
  });

  it.each([
    null,
    makePost(),
    { ...makePost(), id: 2, content: "Wrong article" },
    { ...makePost(), content: null },
  ])("rejects an incomplete or mismatched detail response: %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(getAdminPost(1)).rejects.toMatchObject({ kind: "parse" });
  });

  it.each([401, 403, 404, 503])("preserves HTTP %i as a recoverable load error", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Cannot load article" }, { status })));
    await expect(getAdminPost(1)).rejects.toMatchObject({ kind: "http", status });
  });
});

function makePost(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id: 1,
    title: "Default title",
    slug: "default-title",
    summary: "Default summary",
    category_id: null,
    category: null,
    status: "published",
    published_at: "2026-08-01T10:00:00Z",
    last_edited_at: null,
    created_at: "2026-08-01T09:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("file URL normalization", () => {
  it("uses the validated view endpoint for file download URLs", () => {
    expect(normalizeFileViewUrl("http://localhost:8080/api/files/42/download?inline=1"))
      .toBe("http://localhost:8080/api/files/42/view?inline=1");
  });

  it("rebases stored file URLs from an earlier deployment to the current API", () => {
    expect(normalizeFileViewUrl("https://old.example.test/api/files/42/view"))
      .toBe("http://localhost:8080/api/files/42/view");
    expect(normalizeFileViewUrl("/api/files/42/download"))
      .toBe("/api/files/42/view");
    expect(rebaseFileViewURLs("https://old.example.test/api/files/42/download", "/api"))
      .toBe("/api/files/42/view");
  });

  it("normalizes every file download URL in markdown without changing unrelated URLs", () => {
    const markdown = [
      "![first](http://localhost:8080/api/files/1/download)",
      "[second](http://localhost:8080/api/files/2/download)",
      "[external](https://example.com/download)",
    ].join("\n");

    expect(normalizeMarkdownFileUrls(markdown)).toBe([
      "![first](http://localhost:8080/api/files/1/view)",
      "[second](http://localhost:8080/api/files/2/view)",
      "[external](https://example.com/download)",
    ].join("\n"));
  });

  it("preserves empty values", () => {
    expect(normalizeFileViewUrl("")).toBe("");
    expect(normalizeMarkdownFileUrls("")).toBe("");
  });
});

describe("post timeline", () => {
  it("prefers the latest edit timestamp", () => {
    expect(getPostTimeline(makePost({
      published_at: "2026-08-01T10:00:00Z",
      last_edited_at: "2026-08-03T12:00:00Z",
      updated_at: "2026-08-03T12:00:00Z",
    }))).toEqual({ label: "Updated", timestamp: "2026-08-03T12:00:00Z" });
  });

  it("uses the first publication timestamp when the post has not been edited", () => {
    expect(getPostTimeline(makePost({
      published_at: "2026-08-01T10:00:00Z",
      last_edited_at: null,
      updated_at: "2026-08-02T11:00:00Z",
    }))).toEqual({ label: "Published", timestamp: "2026-08-01T10:00:00Z" });
  });

  it("falls back to updated_at when no publication timestamp exists", () => {
    expect(getPostTimeline(makePost({
      published_at: null,
      last_edited_at: null,
      updated_at: "2026-08-02T11:00:00Z",
    }))).toEqual({ label: "Published", timestamp: "2026-08-02T11:00:00Z" });
  });
});

describe("logout", () => {
  afterEach(() => {
    clearCSRFToken();
    vi.unstubAllGlobals();
  });

  it("accepts an already-expired session as a completed logout", async () => {
    setCSRFToken("csrf-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Invalid or expired session",
      code: "invalid_session",
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(logoutUser()).resolves.toBeUndefined();
  });

  it("does not treat a server failure as a completed logout", async () => {
    setCSRFToken("csrf-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Failed to invalidate session",
      code: "database_error",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(logoutUser()).rejects.toMatchObject({
      status: 500,
      code: "database_error",
    });
  });
});
