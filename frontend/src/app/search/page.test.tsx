import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPageClient from "@/components/SearchPageClient";
import type { PostSummary } from "@/lib/api";

const { navigationState, searchResourcesMock, getCategoriesMock } = vi.hoisted(() => ({
  navigationState: { searchParams: new URLSearchParams("q=existing%20query") },
  searchResourcesMock: vi.fn(),
  getCategoriesMock: vi.fn(),
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
  getCategories: getCategoriesMock,
}));

describe("advanced search input", () => {
  beforeEach(() => {
    getCategoriesMock.mockResolvedValue([]);
    navigationState.searchParams = new URLSearchParams("q=existing%20query");
    window.history.replaceState({}, "", "/search?q=existing%20query");
    searchResourcesMock.mockResolvedValue({ posts: [], files: [], posts_total: 0, files_total: 0, total: 0, page: 1, limit: 10 });
  });

  it("retains body-only matches supplied as summaries by the backend", async () => {
    const post: PostSummary = {
      id: 9, title: "Article returned by the server", slug: "server-result", summary: "Short introduction",
      category_id: null, category: null, status: "published", published_at: "2026-01-01T00:00:00Z",
      last_edited_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    searchResourcesMock.mockResolvedValue({ posts: [post], files: [], posts_total: 1, files_total: 0, total: 1, page: 1, limit: 10 });
    render(<SearchPageClient initialState={{ categoryId: "", scope: "all", page: 1, totalPages: 1, postsTotal: 0, filesTotal: 0, categories: [], query: "existing query", posts: [post], files: [], searched: true, error: "" }} />);
    expect(screen.getByRole("link", { name: /Article returned by the server/ })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Search posts and files" }), { target: { value: "body-only match" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Article returned by the server/ })).toBeVisible();
    expect(searchResourcesMock).toHaveBeenCalledWith({ query: "body-only match", scope: "all", categoryId: "", page: 1 });
  });

  it("starts from the server snapshot without overwriting new input", () => {
    render(<SearchPageClient initialState={{ categoryId: "", scope: "all", page: 1, totalPages: 1, postsTotal: 0, filesTotal: 0, categories: [],
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
    expect(window.location.search).toBe("?q=new+article");
    expect(searchResourcesMock).toHaveBeenCalledWith({ query: "new article", scope: "all", categoryId: "", page: 1 });
  });

  it("reconciles a restored URL when the cached server snapshot has an older query", async () => {
    navigationState.searchParams = new URLSearchParams("q=restored%20article");
    window.history.replaceState({}, "", "/search?q=restored%20article");

    render(<SearchPageClient initialState={{ categoryId: "", scope: "all", page: 1, totalPages: 1, postsTotal: 0, filesTotal: 0, categories: [],
      query: "older file",
      posts: [],
      files: [],
      searched: true,
      error: "",
    }} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Search posts and files" })).toHaveValue("restored article");
      expect(searchResourcesMock).toHaveBeenCalledWith({ query: "restored article", scope: "all", categoryId: "", page: 1 });
    });
  });

  it("keeps current results visible while refreshing and hides categories without published posts", async () => {
    const visibleCategory = { id: 4, name: "Visible category", description: "", post_count: 2, created_at: "2026-01-01T00:00:00Z" };
    const draftOnlyCategory = { id: 5, name: "Draft-only category", description: "", post_count: 0, created_at: "2026-01-01T00:00:00Z" };
    let resolveSearch: ((value: { posts: []; files: []; posts_total: number; files_total: number; total: number; page: number; limit: number }) => void) | undefined;
    getCategoriesMock.mockResolvedValue([visibleCategory, draftOnlyCategory]);
    searchResourcesMock.mockReturnValueOnce(new Promise((resolve) => { resolveSearch = resolve; }));
    const post: PostSummary = {
      id: 10, title: "Existing result", slug: "existing-result", summary: "", category_id: null, category: null,
      status: "published", published_at: "2026-01-01T00:00:00Z", last_edited_at: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    };
    render(<SearchPageClient initialState={{
      categoryId: "", scope: "all", page: 1, totalPages: 1, postsTotal: 1, filesTotal: 0,
      categories: [visibleCategory, draftOnlyCategory], posts: [post], files: [], query: "existing query", searched: true, error: "",
    }} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Search category" }));
    expect(screen.getByRole("option", { name: "Visible category" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Draft-only category" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Visible category" }));

    expect(screen.getByRole("link", { name: /Existing result/ })).toBeVisible();
    expect(screen.getByRole("status", { name: "Updating search results…" })).toBeInTheDocument();
    expect(searchResourcesMock).toHaveBeenCalledWith({ query: "existing query", scope: "all", categoryId: "4", page: 1 });
    resolveSearch?.({ posts: [], files: [], posts_total: 0, files_total: 0, total: 0, page: 1, limit: 10 });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Existing result/ })).not.toBeInTheDocument());
  });

  it("keeps the empty search prompt visible while a filter refreshes", async () => {
    let resolveCategories: ((value: []) => void) | undefined;
    getCategoriesMock.mockReturnValueOnce(new Promise((resolve) => { resolveCategories = resolve; }));
    navigationState.searchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/search");
    render(<SearchPageClient initialState={{
      categoryId: "", scope: "all", page: 1, totalPages: 1, postsTotal: 0, filesTotal: 0,
      categories: [], posts: [], files: [], query: "", searched: false, error: "",
    }} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Search scope" }));
    fireEvent.click(screen.getByRole("option", { name: "Posts" }));

    expect(screen.getByText("Enter a keyword to search across posts and files.")).toBeVisible();
    expect(screen.queryByText("Searching posts and files…")).not.toBeInTheDocument();
    resolveCategories?.([]);
    await waitFor(() => expect(getCategoriesMock).toHaveBeenCalledTimes(1));
  });
});
