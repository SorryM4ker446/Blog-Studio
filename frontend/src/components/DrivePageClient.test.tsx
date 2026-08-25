import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileRecord } from "@/lib/api";
import DrivePageClient from "./DrivePageClient";

const { getFilesMock, navigationState, searchResourcesMock } = vi.hoisted(() => ({
  getFilesMock: vi.fn(),
  navigationState: { searchParams: new URLSearchParams() },
  searchResourcesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/api", () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getFiles: getFilesMock,
  searchResources: searchResourcesMock,
}));

vi.mock("@/components/files/FileCard", () => ({
  default: ({ file }: { file: FileRecord }) => <span>{file.display_name}</span>,
}));

vi.mock("@/components/files/FileDialogs", () => ({ FilePreviewDialog: () => null }));

const defaultFile: FileRecord = {
  id: 4,
  orig_name: "default.txt",
  display_name: "Default file",
  description: "",
  size: 10,
  mime_type: "text/plain",
  is_system: false,
  created_at: "2026-08-26T00:00:00Z",
};

describe("DrivePageClient navigation", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams();
    window.history.replaceState({}, "", "/drive");
    getFilesMock.mockReset();
    searchResourcesMock.mockReset();
    getFilesMock.mockResolvedValue({ data: [defaultFile], page: 1, limit: 10, total: 1 });
    searchResourcesMock.mockResolvedValue({ posts: [], files: [] });
  });

  it("updates the search URL and data without a route remount", async () => {
    render(<DrivePageClient initialState={{ query: "", files: [defaultFile], page: 1, totalPages: 1, error: "" }} />);
    const input = screen.getByRole("textbox", { name: "Search files..." });

    fireEvent.change(input, { target: { value: "report" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(window.location.search).toBe("?q=report");
    await waitFor(() => expect(searchResourcesMock).toHaveBeenCalledWith("report", "files"));
  });

  it("ignores a late search result after the search is cleared", async () => {
    let resolveSearch: ((value: { posts: []; files: FileRecord[] }) => void) | undefined;
    searchResourcesMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSearch = resolve;
    }));
    const lateFile = { ...defaultFile, id: 5, display_name: "Late search file" };
    render(<DrivePageClient initialState={{ query: "", files: [defaultFile], page: 1, totalPages: 1, error: "" }} />);
    const input = screen.getByRole("textbox", { name: "Search files..." });

    fireEvent.change(input, { target: { value: "slow" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "" } });

    expect(window.location.pathname).toBe("/drive");
    expect(window.location.search).toBe("");
    await waitFor(() => expect(getFilesMock).toHaveBeenCalled());
    resolveSearch?.({ posts: [], files: [lateFile] });
    await waitFor(() => expect(screen.getByText("Default file")).toBeVisible());
    expect(screen.queryByText("Late search file")).not.toBeInTheDocument();
  });
});
