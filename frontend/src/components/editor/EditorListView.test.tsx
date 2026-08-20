import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileRecord } from "@/lib/api";
import EditorListView from "./EditorListView";

const file: FileRecord = {
  id: 3,
  orig_name: "diagram.png",
  display_name: "Architecture diagram",
  description: "",
  size: 2048,
  mime_type: "image/png",
  is_system: false,
  created_at: "2026-08-20T12:00:00Z",
};

describe("EditorListView", () => {
  it("keeps the known count and existing content stable during a background refresh", () => {
    render(
      <EditorListView
        activeTab="files"
        searchQuery=""
        posts={[]}
        files={[file]}
        postCount={12}
        fileCount={3}
        postsLoading={false}
        filesLoading
        postsError=""
        filesError=""
        postPage={1}
        postTotalPages={2}
        filePage={1}
        fileTotalPages={2}
        onTabChange={vi.fn()}
        onSearch={vi.fn()}
        onNewPost={vi.fn()}
        onUploadFile={vi.fn()}
        onViewPost={vi.fn()}
        onEditPost={vi.fn()}
        onDeletePost={vi.fn()}
        onPreviewFile={vi.fn()}
        onEditFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onLoadPosts={vi.fn()}
        onLoadFiles={vi.fn()}
        onRetryPosts={vi.fn()}
        onRetryFiles={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Files (3)" })).toBeVisible();
    expect(screen.queryByText(/Files \(…\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Architecture diagram" })).toBeVisible();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeVisible();
  });
});
