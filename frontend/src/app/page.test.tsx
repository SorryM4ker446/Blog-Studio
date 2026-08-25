import { afterEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/api";
import Home from "./page";

const recentPost: Post = {
  id: 9,
  title: "Initial recent article",
  slug: "initial-recent-article",
  summary: "",
  content: "",
  category_id: null,
  category: null,
  status: "published",
  published_at: "2026-08-26T00:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

describe("home server data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes recent articles into the first render", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [recentPost], total: 1, page: 1, limit: 5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await Home();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/posts?page=1&limit=5",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.props).toMatchObject({
      initialPosts: [recentPost],
      initialPostsError: "",
    });
  });

  it("renders a retryable error state when the server request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    const result = await Home();

    expect(result.props).toMatchObject({
      initialPosts: [],
      initialPostsError: "Could not load recent articles.",
    });
  });
});
