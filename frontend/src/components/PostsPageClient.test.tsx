import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/api";
import PostsPageClient from "./PostsPageClient";

const { getCategoriesMock, getPostsMock, navigationState, searchResourcesMock } = vi.hoisted(() => ({
  getCategoriesMock: vi.fn(),
  getPostsMock: vi.fn(),
  navigationState: { searchParams: new URLSearchParams("category=2&q=observability") },
  searchResourcesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Could not search posts.",
  getCategories: getCategoriesMock,
  getPostTimeline: () => ({ label: "Published", timestamp: "2026-08-26T00:00:00Z" }),
  getPosts: getPostsMock,
  searchResources: searchResourcesMock,
}));

const matchingPost: Post = {
  id: 12,
  title: "Go observability",
  slug: "go-observability",
  summary: "Tracing in Go",
  content: "Visible content",
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

describe("category post search", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams("category=2&q=observability");
    window.history.replaceState({}, "", "/posts?category=2&q=observability");
    getCategoriesMock.mockResolvedValue([matchingPost.category]);
    getPostsMock.mockResolvedValue({ data: [matchingPost], page: 1, limit: 10, total: 1 });
    searchResourcesMock.mockResolvedValue({ posts: [matchingPost], files: [] });
  });

  it("keeps the selected category when retrying a search", async () => {
    render(<PostsPageClient initialState={{
      query: "observability",
      posts: [],
      page: 1,
      totalPages: 1,
      currentCategoryName: "Go",
      error: "Could not search posts.",
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(searchResourcesMock).toHaveBeenCalledWith("observability", "posts", "2");
    });
    expect(await screen.findByText("Go observability")).toBeVisible();
  });

  it("preserves the category parameter and searches without remounting the page", async () => {
    render(<PostsPageClient initialState={{
      query: "observability",
      posts: [],
      page: 1,
      totalPages: 1,
      currentCategoryName: "Go",
      error: "",
    }} />);
    const input = screen.getByRole("textbox", { name: "Search posts..." });

    fireEvent.change(input, { target: { value: "tracing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(window.location.pathname).toBe("/posts");
    expect(window.location.search).toBe("?category=2&q=tracing");
    await waitFor(() => {
      expect(searchResourcesMock).toHaveBeenCalledWith("tracing", "posts", "2");
    });
  });

  it("prevents a late search response from replacing the restored default list", async () => {
    navigationState.searchParams = new URLSearchParams("category=2");
    window.history.replaceState({}, "", "/posts?category=2");
    let resolveSearch: ((value: { posts: Post[]; files: [] }) => void) | undefined;
    searchResourcesMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSearch = resolve;
    }));
    const slowResult = { ...matchingPost, id: 13, title: "Late search result" };
    render(<PostsPageClient initialState={{
      query: "",
      posts: [matchingPost],
      page: 1,
      totalPages: 1,
      currentCategoryName: "Go",
      error: "",
    }} />);
    const input = screen.getByRole("textbox", { name: "Search posts..." });

    fireEvent.change(input, { target: { value: "slow" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => expect(getPostsMock).toHaveBeenCalled());
    resolveSearch?.({ posts: [slowResult], files: [] });
    await waitFor(() => expect(screen.getByText("Go observability")).toBeVisible());
    expect(screen.queryByText("Late search result")).not.toBeInTheDocument();
  });
});
