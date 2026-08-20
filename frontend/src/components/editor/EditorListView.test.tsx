import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileRecord, Post } from "@/lib/api";
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

const post: Post = {
  id: 7,
  title: "Clickable post",
  slug: "clickable-post",
  summary: "Post summary",
  content: "Post content",
  category_id: 2,
  category: {
    id: 2,
    name: "Testing",
    description: "",
    created_at: "2026-08-20T12:00:00Z",
  },
  status: "published",
  published_at: "2026-08-20T12:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-20T12:00:00Z",
  updated_at: "2026-08-20T12:00:00Z",
};

describe("EditorListView", () => {
  it("opens a post from its metadata while keeping edit and delete actions independent", async () => {
    const user = userEvent.setup();
    const onViewPost = vi.fn();
    const onEditPost = vi.fn();
    const onDeletePost = vi.fn();

    render(
      <EditorListView
        activeTab="posts"
        searchQuery=""
        posts={[post]}
        files={[]}
        postCount={1}
        fileCount={0}
        postsLoading={false}
        filesLoading={false}
        postsError=""
        filesError=""
        postPage={1}
        postTotalPages={1}
        filePage={1}
        fileTotalPages={1}
        onTabChange={vi.fn()}
        onSearch={vi.fn()}
        onNewPost={vi.fn()}
        onUploadFile={vi.fn()}
        onViewPost={onViewPost}
        onEditPost={onEditPost}
        onDeletePost={onDeletePost}
        onPreviewFile={vi.fn()}
        onEditFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onLoadPosts={vi.fn()}
        onLoadFiles={vi.fn()}
        onRetryPosts={vi.fn()}
        onRetryFiles={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Testing"));
    expect(onViewPost).toHaveBeenCalledWith(post);

    onViewPost.mockClear();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete Clickable post" }));
    expect(onEditPost).toHaveBeenCalledWith(post);
    expect(onDeletePost).toHaveBeenCalledWith(post.id);
    expect(onViewPost).not.toHaveBeenCalled();
  });

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
