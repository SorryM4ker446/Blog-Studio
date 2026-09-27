import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileRecord, PostSummary } from "@/lib/api";
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

const post: PostSummary = {
  id: 7,
  title: "Clickable post",
  slug: "clickable-post",
  summary: "Post summary",
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
  it("opens a post from its title while keeping menu actions independent", async () => {
    const user = userEvent.setup();
    const onViewPost = vi.fn();
    const onEditPost = vi.fn();
    const onDeletePost = vi.fn();

    render(
      <EditorListView
        links={{ query: "", loading: false, error: "", count: 0, search: vi.fn(), toolbar: <></>, content: <></>, dialogs: <></> }}
        activeTab="posts"
        searchQuery=""
        categories={[]}
        categoryId=""
        onCategoryChange={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Open Clickable post" }));
    expect(onViewPost).toHaveBeenCalledWith(post);

    onViewPost.mockClear();
    const more = screen.getByRole("button", { name: "More actions for Clickable post" });
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onEditPost).toHaveBeenCalledWith(post);
    expect(onDeletePost).toHaveBeenCalledWith(post.id);
    expect(onViewPost).not.toHaveBeenCalled();
    await user.click(more);
    const newPost = screen.getByRole("button", { name: "New Post" });
    newPost.focus();
    expect(newPost).toHaveFocus();
    await waitFor(() => expect(more).toHaveAttribute("aria-expanded", "false"));
  });

  it("keeps the known count and existing content stable during a background refresh", async () => {
    const user = userEvent.setup();
    const onPreviewFile = vi.fn();
    const onEditFile = vi.fn();
    const onDeleteFile = vi.fn();
    render(
      <EditorListView
        links={{ query: "", loading: false, error: "", count: 0, search: vi.fn(), toolbar: <></>, content: <></>, dialogs: <></> }}
        activeTab="files"
        searchQuery=""
        categories={[]}
        categoryId=""
        onCategoryChange={vi.fn()}
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
        onPreviewFile={onPreviewFile}
        onEditFile={onEditFile}
        onDeleteFile={onDeleteFile}
        onLoadPosts={vi.fn()}
        onLoadFiles={vi.fn()}
        onRetryPosts={vi.fn()}
        onRetryFiles={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Files (3)" })).toBeVisible();
    expect(screen.queryByText(/Files \(…\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Architecture diagram" })).toBeVisible();
    expect(screen.getByText("No description provided.")).toBeVisible();
    expect(screen.queryByText("diagram.png")).not.toBeInTheDocument();
    expect(screen.getByText("PNG image")).toBeVisible();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Preview Architecture diagram" }));
    expect(onPreviewFile).toHaveBeenCalledWith(file);
    const more = screen.getByRole("button", { name: "More actions for Architecture diagram" });
    await user.click(more);
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", expect.stringContaining(String(file.id)));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onEditFile).toHaveBeenCalledWith(file);
    expect(onDeleteFile).toHaveBeenCalledWith(file.id);
  });
});
