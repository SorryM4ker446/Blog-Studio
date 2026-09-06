import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDetail, PostSummary } from "@/lib/api";
import EditorPageClient, { type EditorPageInitialState } from "./EditorPageClient";

const { getAdminFilesMock, getAdminPostsMock, getAdminPostMock, createPostMock, updatePostMock, navigationState, pushMock, refreshMock } = vi.hoisted(() => ({
  getAdminFilesMock: vi.fn(),
  getAdminPostsMock: vi.fn(),
  getAdminPostMock: vi.fn(),
  createPostMock: vi.fn(),
  updatePostMock: vi.fn(),
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
  createPost: createPostMock,
  deleteCategory: vi.fn(),
  deleteFile: vi.fn(),
  deletePost: vi.fn(),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getAdminCategories: vi.fn(),
  getAdminFiles: getAdminFilesMock,
  getAdminPosts: getAdminPostsMock,
  getAdminPost: getAdminPostMock,
  getFileViewUrl: vi.fn(),
  normalizeMarkdownFileUrls: (value: string) => value,
  searchAdminResources: vi.fn(),
  updateCategory: vi.fn(),
  updateFileMetadata: vi.fn(),
  updatePost: updatePostMock,
  uploadFile: vi.fn(),
  uploadFileWithMetadata: vi.fn(),
}));

vi.mock("@/components/editor/EditorListView", () => ({
  default: (props: {
    activeTab: "posts" | "files";
    posts: PostSummary[];
    postsError: string;
    postsLoading: boolean;
    onTabChange: (tab: "posts" | "files") => void;
    onEditPost: (post: PostSummary) => void;
    onNewPost: () => void;
  }) => (
    <div data-testid="editor-list">
      <button type="button" onClick={() => props.onTabChange("posts")}>Posts</button>
      <button type="button" onClick={() => props.onTabChange("files")}>Files</button>
      <button type="button" onClick={props.onNewPost}>New article</button>
      <span data-testid="active-tab">{props.activeTab}</span>
      {props.postsLoading && <span>Recovering posts</span>}
      {!props.postsLoading && props.postsError && <span>{props.postsError}</span>}
      {props.posts.map((post) => <button key={post.id} onClick={() => props.onEditPost(post)}>{post.title}</button>)}
    </div>
  ),
}));

vi.mock("@/components/editor/EditorDeleteDialog", () => ({ default: () => null }));
vi.mock("@/components/editor/PostEditorForm", () => ({
  default: (props: { title: string; content: string; saving: boolean; onSave: () => Promise<void>; onBack: () => void }) => (
    <div>
      <span data-testid="editing-title">{props.title}</span>
      <textarea aria-label="Loaded article body" value={props.content} readOnly />
      <button disabled={props.saving} onClick={() => void props.onSave()}>Save article</button>
      <button onClick={props.onBack}>Back to content list</button>
    </div>
  ),
}));
vi.mock("@/components/files/FileDialogs", () => ({
  FileEditDialog: () => null,
  FilePreviewDialog: () => null,
  FileUploadDialog: () => null,
}));

const recoveredPost: PostSummary = {
  id: 7,
  title: "Recovered editor post",
  slug: "recovered-editor-post",
  summary: "",
  category_id: null,
  category: null,
  status: "published",
  published_at: "2026-08-26T00:00:00Z",
  last_edited_at: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const emptySnapshot = { data: [], page: 1, totalPages: 1, total: 0 };

const readyState: EditorPageInitialState = {
  posts: { ...emptySnapshot, data: [recoveredPost, { ...recoveredPost, id: 8, title: "Another article" }], total: 2 },
  files: emptySnapshot, postQuery: { query: "", categoryId: "", scope: "posts", page: 1 }, fileQuery: { query: "", categoryId: "", scope: "files", page: 1 },
  categories: [], postsError: "", filesError: "", categoriesError: "",
};
const fullPost: PostDetail = { ...recoveredPost, title: "Fresh server title", content: "Full body from the detail endpoint" };

function pendingDetail() {
  let resolve!: (post: PostDetail) => void;
  const promise = new Promise<PostDetail>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Editor article detail loading", () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams("tab=posts");
    window.history.replaceState({}, "", "/editor?tab=posts");
    getAdminPostMock.mockReset();
    createPostMock.mockReset();
    updatePostMock.mockReset();
    getAdminPostsMock.mockResolvedValue({ data: [recoveredPost], page: 1, limit: 10, total: 1 });
  });

  it("loads a fresh body on edit and saves the full detail to the existing article", async () => {
    const pending = pendingDetail();
    getAdminPostMock.mockReturnValue(pending.promise);
    updatePostMock.mockResolvedValue(fullPost);
    render(<EditorPageClient initialState={readyState} />);
    expect(getAdminPostMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    expect(screen.getByText("Loading article…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save article" })).not.toBeInTheDocument();
    expect(getAdminPostMock).toHaveBeenCalledWith(7, { signal: expect.any(AbortSignal) });
    expect(createPostMock).not.toHaveBeenCalled();
    expect(updatePostMock).not.toHaveBeenCalled();

    await act(async () => pending.resolve(fullPost));
    expect(screen.getByTestId("editing-title")).toHaveTextContent("Fresh server title");
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue(fullPost.content);
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenCalledWith(7, expect.objectContaining({
      title: fullPost.title, content: fullPost.content, status: "published",
    })));
    expect(createPostMock).not.toHaveBeenCalled();
  });

  it("keeps failures retryable without exposing an empty saveable form", async () => {
    getAdminPostMock.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(fullPost);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    expect(await screen.findByText("Article could not be loaded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save article" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("textbox", { name: "Loaded article body" })).toHaveValue(fullPost.content);
    expect(getAdminPostMock).toHaveBeenCalledTimes(2);
    expect(updatePostMock).not.toHaveBeenCalled();
    expect(createPostMock).not.toHaveBeenCalled();
  });

  it("aborts a cancelled read and ignores its late response after another article loads", async () => {
    const old = pendingDetail();
    const current = pendingDetail();
    getAdminPostMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    const oldSignal = getAdminPostMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Back to content list" }));
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Another article" }));
    await act(async () => current.resolve({ ...fullPost, id: 8, title: "Current article", content: "Current body" }));
    await act(async () => old.resolve(fullPost));
    expect(screen.getByTestId("editing-title")).toHaveTextContent("Current article");
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue("Current body");
    expect(updatePostMock).not.toHaveBeenCalled();
  });

  it("starts a new draft without a detail request", () => {
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: "New article" }));
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue("");
    expect(getAdminPostMock).not.toHaveBeenCalled();
  });

  it("does not show a cancelled request failure after returning to the list", async () => {
    let reject!: (error: Error) => void;
    getAdminPostMock.mockReturnValue(new Promise<PostDetail>((_resolve, fail) => { reject = fail; }));
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    fireEvent.click(screen.getByRole("button", { name: "Back to content list" }));
    await act(async () => reject(new DOMException("Cancelled", "AbortError")));
    expect(screen.getByTestId("editor-list")).toBeVisible();
    expect(screen.queryByText("Article could not be loaded")).not.toBeInTheDocument();
    expect(updatePostMock).not.toHaveBeenCalled();
  });

  it("aborts the pending detail request when the editor unmounts", async () => {
    const pending = pendingDetail();
    getAdminPostMock.mockReturnValue(pending.promise);
    const view = render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    const signal = getAdminPostMock.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(fullPost));
    expect(updatePostMock).not.toHaveBeenCalled();
    expect(createPostMock).not.toHaveBeenCalled();
  });
});

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
      postQuery: { query: "", categoryId: "", scope: "posts", page: 1 },
      fileQuery: { query: "", categoryId: "", scope: "files", page: 1 },
      categories: [],
      postsError: "Failed to load posts.",
      filesError: "",
      categoriesError: "",
    };

    render(<EditorPageClient initialState={initialState} />);

    expect(screen.getByText("Recovering posts")).toBeVisible();
    expect(screen.queryByText("Failed to load posts.")).not.toBeInTheDocument();
    await waitFor(() => expect(getAdminPostsMock).toHaveBeenCalledWith(1, 10, "admin", ""));
    expect(await screen.findByText("Recovered editor post")).toBeVisible();
    expect(screen.queryByText("Failed to load posts.")).not.toBeInTheDocument();
  });

  it("keeps the editor client mounted and reuses loaded data while switching tabs", () => {
    const initialState: EditorPageInitialState = {
      posts: emptySnapshot,
      files: emptySnapshot,
      postQuery: { query: "", categoryId: "", scope: "posts", page: 1 },
      fileQuery: { query: "", categoryId: "", scope: "files", page: 1 },
      categories: [],
      postsError: "",
      filesError: "",
      categoriesError: "",
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
