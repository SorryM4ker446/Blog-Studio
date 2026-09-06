import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPageClient from "@/components/SearchPageClient";
import type { PostSummary } from "@/lib/api";

const { navigationState, searchResourcesMock } = vi.hoisted(() => ({
  navigationState: { searchParams: new URLSearchParams("q=existing%20query") },
  searchResourcesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Search failed",
  getDownloadUrl: () => "/download",
  getFileViewUrl: () => "/view",
  getPostTimeline: () => ({ label: "Published", timestamp: "2026-01-01T00:00:00Z" }),
  searchResources: searchResourcesMock,
}));

describe("advanced search input", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams("q=existing%20query");
    window.history.replaceState({}, "", "/search?q=existing%20query");
    searchResourcesMock.mockResolvedValue({ posts: [], files: [] });
  });

  it("retains body-only matches supplied as summaries by the backend", async () => {
    const post: PostSummary = {
      id: 9, title: "Article returned by the server", slug: "server-result", summary: "Short introduction",
      category_id: null, category: null, status: "published", published_at: "2026-01-01T00:00:00Z",
      last_edited_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    searchResourcesMock.mockResolvedValue({ posts: [post], files: [] });
    render(<SearchPageClient initialState={{ query: "existing query", posts: [post], files: [], searched: true, error: "" }} />);
    expect(screen.getByRole("link", { name: /Article returned by the server/ })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Search posts and files" }), { target: { value: "body-only match" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Article returned by the server/ })).toBeVisible();
    expect(searchResourcesMock).toHaveBeenCalledWith("body-only match");
  });

  it("starts from the server snapshot without overwriting new input", () => {
    render(<SearchPageClient initialState={{
      query: "existing query",
      posts: [],
      files: [],
      searched: true,
      error: "",
    }} />);
    const input = screen.getByRole("textbox", { name: "Search posts and files" });
    fireEvent.change(input, { target: { value: "new article" } });
    expect(input).toHaveValue("new article");
    expect(searchResourcesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(window.location.search).toBe("?q=new%20article");
    expect(searchResourcesMock).toHaveBeenCalledWith("new article");
  });

  it("reconciles a restored URL when the cached server snapshot has an older query", async () => {
    navigationState.searchParams = new URLSearchParams("q=restored%20article");
    window.history.replaceState({}, "", "/search?q=restored%20article");

    render(<SearchPageClient initialState={{
      query: "older file",
      posts: [],
      files: [],
      searched: true,
      error: "",
    }} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Search posts and files" })).toHaveValue("restored article");
      expect(searchResourcesMock).toHaveBeenCalledWith("restored article");
    });
  });
});
