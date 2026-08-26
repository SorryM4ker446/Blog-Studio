import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSearchablePostContent,
  filterPostsByVisibleText,
  getPostTimeline,
  logoutUser,
  normalizeFileViewUrl,
  normalizeMarkdownFileUrls,
  type Post,
} from "./api";
import { clearCSRFToken, setCSRFToken } from "./api-client";
import { rebaseFileViewURLs } from "./file-url";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    title: "Default title",
    slug: "default-title",
    summary: "Default summary",
    content: "Default content",
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

describe("visible post text extraction", () => {
  it("removes image metadata and URLs while retaining visible link text", () => {
    const content = [
      "Visible paragraph",
      "![private-image-name](http://localhost:8080/api/files/9/view)",
      "Read [the public guide](https://example.com/private-target)",
      "https://example.com/bare-target",
    ].join("\n");

    const searchable = extractSearchablePostContent(content);

    expect(searchable).toContain("Visible paragraph");
    expect(searchable).toContain("the public guide");
    expect(searchable).not.toContain("private-image-name");
    expect(searchable).not.toContain("private-target");
    expect(searchable).not.toContain("bare-target");
  });

  it("matches title, summary, category, and visible content case-insensitively", () => {
    const posts = [
      makePost({ id: 1, title: "Release Notes" }),
      makePost({ id: 2, title: "Other", summary: "Architecture overview" }),
      makePost({
        id: 3,
        title: "Other",
        summary: "Other",
        category: {
          id: 4,
          name: "Engineering",
          description: "",
          created_at: "2026-08-01T09:00:00Z",
        },
      }),
      makePost({ id: 4, title: "Other", summary: "Other", content: "A visible tutorial" }),
    ];

    expect(filterPostsByVisibleText(posts, " release ")).toEqual([posts[0]]);
    expect(filterPostsByVisibleText(posts, "ARCHITECTURE")).toEqual([posts[1]]);
    expect(filterPostsByVisibleText(posts, "engineering")).toEqual([posts[2]]);
    expect(filterPostsByVisibleText(posts, "tutorial")).toEqual([posts[3]]);
  });

  it("does not match image labels or targets", () => {
    const post = makePost({
      content: "Visible text\n![hidden-file-name](http://localhost:8080/api/files/27/view)",
    });

    expect(filterPostsByVisibleText([post], "hidden-file-name")).toEqual([]);
    expect(filterPostsByVisibleText([post], "files/27")).toEqual([]);
  });

  it("returns the original list for a blank query", () => {
    const posts = [makePost()];
    expect(filterPostsByVisibleText(posts, "   ")).toBe(posts);
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
