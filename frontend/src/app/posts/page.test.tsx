import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostSummary } from "@/lib/api";
import AllPostsPage from "./page";

const matchingPost: PostSummary = {
  id: 12,
  title: "Go observability",
  slug: "go-observability",
  summary: "Tracing in Go",
  category_id: 2,
  category: {
    id: 2,
    name: "Go",
    description: "",
    created_at: "2026-08-26T00:00:00Z",
  },
  status: "published",
  published_at: "2026-08-26T00:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

describe("posts server search", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the selected category to the search endpoint", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith("/categories")
        ? [{ id: 2, name: "Go", description: "", post_count: 1, created_at: "2026-08-26T00:00:00Z" }]
        : { posts: [matchingPost], files: [], posts_total: 1, files_total: 0, total: 1, page: 1, limit: 10 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await AllPostsPage({
      searchParams: Promise.resolve({ q: "observability", category: "2" }),
    });

    const searchCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/search?"));
    expect(searchCall).toBeDefined();
    const searchURL = new URL(String(searchCall![0]));
    expect(Object.fromEntries(searchURL.searchParams)).toEqual({
      q: "observability",
      scope: "posts",
      category_id: "2",
      page: "1",
      limit: "10",
    });
    expect(result.props.initialState).toMatchObject({
      posts: [matchingPost],
      currentCategoryName: "Go",
      error: "",
    });
  });
});
