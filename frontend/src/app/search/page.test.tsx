import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "./page";

const { pushMock, searchResourcesMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchResourcesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams("q=existing%20query"),
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
    searchResourcesMock.mockResolvedValue({ posts: [], files: [] });
  });

  it("does not overwrite typing that occurs before URL synchronization", async () => {
    let pendingFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(<SearchPage />);
    const input = screen.getByRole("textbox", { name: "Search posts and files" });
    fireEvent.change(input, { target: { value: "new article" } });
    expect(input).toHaveValue("new article");

    await act(async () => {
      pendingFrame?.(performance.now());
      await Promise.resolve();
    });

    expect(input).toHaveValue("new article");
    expect(searchResourcesMock).toHaveBeenCalledWith("existing query");
  });
});
