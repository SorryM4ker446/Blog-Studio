import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/api";
import HomePageClient from "./HomePageClient";

const { getPostsMock, pushMock } = vi.hoisted(() => ({
  getPostsMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: () => "Could not load recent articles.",
  getPostTimeline: (post: Post) => ({
    label: "Published",
    timestamp: post.published_at || post.updated_at,
  }),
  getPosts: getPostsMock,
}));

const recentPost: Post = {
  id: 7,
  title: "Server-rendered article",
  slug: "server-rendered-article",
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

describe("home recent articles", () => {
  beforeEach(() => {
    getPostsMock.mockResolvedValue({ data: [recentPost] });
  });

  it("renders server-provided articles without starting a browser request", () => {
    render(<HomePageClient initialPosts={[recentPost]} />);

    expect(screen.getByText("Server-rendered article")).toBeVisible();
    expect(screen.queryByText("Loading recent articles…")).not.toBeInTheDocument();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it("keeps the browser retry for a failed server request", async () => {
    render(
      <HomePageClient
        initialPosts={[]}
        initialPostsError="Could not load recent articles."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("Server-rendered article")).toBeVisible();
    });
    expect(getPostsMock).toHaveBeenCalledWith(1, 5);
  });
});
