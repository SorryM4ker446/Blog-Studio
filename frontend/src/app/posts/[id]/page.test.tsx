import { afterEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/api";
import PostPage from "./page";

const post: Post = {
  id: 42,
  title: "Container-safe article",
  slug: "container-safe-article",
  summary: "",
  content: "Content",
  category_id: null,
  category: null,
  status: "published",
  published_at: "2026-08-26T00:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

describe("post detail server data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the article and public profile through the internal API", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.endsWith("/settings")
        ? { profile_name: "Ada", profile_tag: "Admin" }
        : post;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await PostPage({ params: Promise.resolve({ id: "42" }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/posts/42",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/settings",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(JSON.stringify(result)).toContain("Container-safe article");
  });
});
