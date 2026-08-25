import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPageClient from "@/components/SearchPageClient";

const { navigationState, searchResourcesMock } = vi.hoisted(() => ({
  navigationState: { searchParams: new URLSearchParams("q=existing%20query") },
  searchResourcesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/api", () => ({
  filterPostsByVisibleText: (posts: unknown[]) => posts,
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
