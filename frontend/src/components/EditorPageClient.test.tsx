import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/api";
import EditorPageClient, { type EditorPageInitialState } from "./EditorPageClient";

const { getAdminFilesMock, getAdminPostsMock, navigationState, pushMock, refreshMock } = vi.hoisted(() => ({
  getAdminFilesMock: vi.fn(),
  getAdminPostsMock: vi.fn(),
  navigationState: { searchParams: new URLSearchParams("tab=posts") },
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", role: "admin" },
    isLoading: false,
    authStatus: "authenticated",
    authError: "",
    refreshAuth: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  createCategory: vi.fn(),
  createPost: vi.fn(),
  deleteCategory: vi.fn(),
  deleteFile: vi.fn(),
  deletePost: vi.fn(),
  filterPostsByVisibleText: (posts: Post[]) => posts,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getAdminCategories: vi.fn(),
  getAdminFiles: getAdminFilesMock,
  getAdminPosts: getAdminPostsMock,
  getFileViewUrl: vi.fn(),
  normalizeMarkdownFileUrls: (value: string) => value,
  searchAdminResources: vi.fn(),
  updateCategory: vi.fn(),
  updateFileMetadata: vi.fn(),
  updatePost: vi.fn(),
  uploadFile: vi.fn(),
  uploadFileWithMetadata: vi.fn(),
}));

vi.mock("@/components/editor/EditorListView", () => ({
  default: (props: {
    activeTab: "posts" | "files";
    posts: Post[];
    postsError: string;
    postsLoading: boolean;
    onTabChange: (tab: "posts" | "files") => void;
  }) => (
    <div data-testid="editor-list">
      <button type="button" onClick={() => props.onTabChange("posts")}>Posts</button>
      <button type="button" onClick={() => props.onTabChange("files")}>Files</button>
      <span data-testid="active-tab">{props.activeTab}</span>
      {props.postsLoading && <span>Recovering posts</span>}
      {!props.postsLoading && props.postsError && <span>{props.postsError}</span>}
      {props.posts.map((post) => <span key={post.id}>{post.title}</span>)}
    </div>
  ),
}));

vi.mock("@/components/editor/EditorDeleteDialog", () => ({ default: () => null }));
vi.mock("@/components/editor/PostEditorForm", () => ({ default: () => null }));
vi.mock("@/components/files/FileDialogs", () => ({
  FileEditDialog: () => null,
  FilePreviewDialog: () => null,
  FileUploadDialog: () => null,
}));

const recoveredPost: Post = {
  id: 7,
  title: "Recovered editor post",
  slug: "recovered-editor-post",
  summary: "",
  content: "Content",
  category_id: null,
  category: null,
  status: "published",
  published_at: "2026-08-26T00:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const emptySnapshot = { data: [], page: 1, totalPages: 1, total: 0 };

describe("EditorPageClient initial request recovery", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams("tab=posts");
    window.history.replaceState({}, "", "/editor?tab=posts");
    pushMock.mockReset();
    refreshMock.mockReset();
    getAdminFilesMock.mockReset();
    getAdminPostsMock.mockReset();
    getAdminPostsMock.mockResolvedValue({
      data: [recoveredPost],
      page: 1,
      limit: 10,
      total: 1,
    });
  });

  it("reloads a failed server-rendered post list after client authentication succeeds", async () => {
    const initialState: EditorPageInitialState = {
      posts: emptySnapshot,
      files: emptySnapshot,
      postDefault: emptySnapshot,
      fileDefault: emptySnapshot,
      categories: [],
      postsError: "Failed to load posts.",
      filesError: "",
      categoriesError: "",
      postViewQuery: null,
      fileViewQuery: null,
    };

    render(<EditorPageClient initialState={initialState} />);

    expect(screen.getByText("Recovering posts")).toBeVisible();
    expect(screen.queryByText("Failed to load posts.")).not.toBeInTheDocument();
    await waitFor(() => expect(getAdminPostsMock).toHaveBeenCalledWith(1, 10, "admin"));
    expect(await screen.findByText("Recovered editor post")).toBeVisible();
    expect(screen.queryByText("Failed to load posts.")).not.toBeInTheDocument();
  });

  it("keeps the editor client mounted and reuses loaded data while switching tabs", () => {
    const initialState: EditorPageInitialState = {
      posts: emptySnapshot,
      files: emptySnapshot,
      postDefault: emptySnapshot,
      fileDefault: emptySnapshot,
      categories: [],
      postsError: "",
      filesError: "",
      categoriesError: "",
      postViewQuery: null,
      fileViewQuery: null,
    };
    const view = render(<EditorPageClient initialState={initialState} />);
    const editorList = screen.getByTestId("editor-list");

    screen.getByRole("button", { name: "Files" }).click();
    expect(window.location.search).toBe("?tab=files");
    expect(pushMock).not.toHaveBeenCalled();
    expect(getAdminFilesMock).not.toHaveBeenCalled();

    navigationState.searchParams = new URLSearchParams("tab=files");
    view.rerender(<EditorPageClient initialState={initialState} />);
    expect(screen.getByTestId("editor-list")).toBe(editorList);
    expect(screen.getByTestId("active-tab")).toHaveTextContent("files");
  });
});
