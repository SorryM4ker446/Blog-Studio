import type { ComponentProps } from "react";
import type PostEditorForm from "./editor/PostEditorForm";
import { ApiError } from "@/lib/api-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDetail, PostSummary } from "@/lib/api";
import EditorPageClient, { type EditorPageInitialState } from "./EditorPageClient";

const { getAdminFilesMock, getAdminPostsMock, getAdminPostMock, createPostMock, updatePostMock, publishPostMock, unpublishPostMock, navigationState, pushMock, refreshMock } = vi.hoisted(() => ({
  getAdminFilesMock: vi.fn(),
  getAdminPostsMock: vi.fn(),
  getAdminPostMock: vi.fn(),
  createPostMock: vi.fn(),
  updatePostMock: vi.fn(),
  publishPostMock: vi.fn(),
  unpublishPostMock: vi.fn(),
  navigationState: { searchParams: new URLSearchParams("tab=posts"), userId: 1, delayedParams: null as URLSearchParams | null },
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => navigationState.delayedParams ?? new URLSearchParams(window.location.search),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: navigationState.userId, username: "admin", role: "admin" },
    isLoading: false,
    authStatus: "authenticated",
    authError: "",
    refreshAuth: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  createCategory: vi.fn(),
  createPost: createPostMock,
  publishPost: publishPostMock,
  unpublishPost: unpublishPostMock,
  isApiError: (error: unknown) => error instanceof Error && "status" in error,
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
    openingError?: string;
    onRetryOpen: () => void;
    onTabChange: (tab: "posts" | "files") => void;
    onEditPost: (post: PostSummary) => void;
    onNewPost: () => void;
  }) => (
    <div data-testid="editor-list">
      <button type="button" onClick={() => props.onTabChange("posts")}>Posts</button>
      <button type="button" onClick={() => props.onTabChange("files")}>Files</button>
      <button type="button" onClick={props.onNewPost}>New article</button>
      {props.openingError && <><span>Article could not be loaded</span><button onClick={props.onRetryOpen}>Try again</button></>}
      <span data-testid="active-tab">{props.activeTab}</span>
      {props.postsLoading && <span>Recovering posts</span>}
      {!props.postsLoading && props.postsError && <span>{props.postsError}</span>}
      {props.posts.map((post) => <button key={post.id} onClick={() => props.onEditPost(post)}>{post.title}</button>)}
    </div>
  ),
}));

vi.mock("@/components/editor/EditorDeleteDialog", () => ({ default: () => null }));
vi.mock("@/components/editor/PostEditorForm", () => ({
  default: (props: ComponentProps<typeof PostEditorForm>) => (
    <div>
      <span data-testid="editing-title">{props.title}</span>
      <input aria-label="Article title" value={props.title} onChange={event => props.onTitleChange(event.target.value)} />
      <textarea aria-label="Loaded article body" value={props.content} onChange={event => props.onContentChange(event.target.value)} />
      <span role="status">{props.saveMessage}</span>
      {props.validationAttempted && <span data-testid="field-validation">Required fields checked</span>}
      <button disabled={props.saving || props.conflict || props.recoveryPending} onClick={() => void props.onSave()}>Save article</button>
      <button onClick={props.onBack}>Back to content list</button>
      <span>{props.dirty ? "Unsaved changes" : "All changes saved"}</span>
      <button disabled={props.saving || props.conflict || props.recoveryPending} onClick={() => void props.onPublish()}>Publish article</button>
      <button disabled={props.saving || props.conflict || props.recoveryPending} onClick={() => void props.onUnpublish()}>Unpublish article</button>
      {props.conflict && <button onClick={props.onLoadLatest}>Load latest</button>}
      {props.latestPost && <button onClick={props.onUseLatest}>Discard and use latest</button>}
      {props.sessionExpired && <span>Sign in again</span>}
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
const fullPost: PostDetail = { ...recoveredPost, version: 1, title: "Fresh server title", content: "Full body from the detail endpoint" };

function pendingDetail() {
  let resolve!: (post: PostDetail) => void;
  const promise = new Promise<PostDetail>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Editor article detail loading", () => {
  beforeEach(() => {
    navigationState.delayedParams = null;
    navigationState.userId = 1;
    navigationState.searchParams = new URLSearchParams("tab=posts");
    window.history.replaceState({}, "", "/editor?tab=posts");
    getAdminPostMock.mockReset();
    createPostMock.mockReset();
    updatePostMock.mockReset();
    publishPostMock.mockReset();
    unpublishPostMock.mockReset();
    getAdminPostsMock.mockResolvedValue({ data: [recoveredPost], page: 1, limit: 10, total: 1 });
  });

  it("clears the previous account's server snapshot before loading the next account", async () => {
    const view = render(<EditorPageClient initialState={readyState} />);
    expect(screen.getByRole("button", { name: recoveredPost.title })).toBeVisible();
    let resolve!: (value: unknown) => void;
    getAdminPostsMock.mockReturnValue(new Promise(done => { resolve = done; }));
    getAdminFilesMock.mockResolvedValue({ data: [], page: 1, limit: 10, total: 0 });
    navigationState.userId = 2;
    view.rerender(<EditorPageClient initialState={readyState} />);
    expect(screen.queryByRole("button", { name: recoveredPost.title })).not.toBeInTheDocument();
    expect(screen.getByText("Recovering posts")).toBeVisible();
    await act(async () => resolve({ data: [{ ...recoveredPost, id: 42, title: "Next account article" }], page: 1, limit: 10, total: 1 }));
    expect(await screen.findByRole("button", { name: "Next account article" })).toBeVisible();
    expect(screen.queryByRole("button", { name: recoveredPost.title })).not.toBeInTheDocument();
  });

  it("rejects incomplete article fields before creating a draft or publishing", async () => {
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: "New article" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    expect(screen.getByTestId("field-validation")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Article title"), { target: { value: "Title only" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish article" }));
    expect(screen.getByTestId("field-validation")).toBeVisible();
    expect(createPostMock).not.toHaveBeenCalled();
    expect(publishPostMock).not.toHaveBeenCalled();
  });

  it("keeps a newly created draft after publication fails and retries without creating another", async () => {
    const draft = { ...fullPost, status: "draft" };
    createPostMock.mockResolvedValue(draft);
    publishPostMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ...draft, status: "published", version: 2 });
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: "New article" }));
    fireEvent.change(screen.getByLabelText("Article title"), { target: { value: draft.title } });
    fireEvent.change(screen.getByLabelText("Loaded article body"), { target: { value: draft.content } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish article" })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish article" }));
    });
    await screen.findByText(/Draft created; publication failed/);
    expect(new URL(window.location.href).searchParams.get("edit")).toBe(String(draft.id));
    expect(screen.getByLabelText("Loaded article body")).toHaveValue(draft.content);
    fireEvent.click(screen.getByRole("button", { name: "Publish article" }));
    await screen.findByTestId("editor-list");
    expect(createPostMock).toHaveBeenCalledTimes(1);
    expect(publishPostMock).toHaveBeenCalledTimes(2);
    expect(publishPostMock).toHaveBeenLastCalledWith(draft.id, expect.objectContaining({ version: 1 }));
  });

  it("preserves unsaved edits when withdrawing publication and saves with the returned version", async () => {
    getAdminPostMock.mockResolvedValue(fullPost);
    unpublishPostMock.mockResolvedValue({ ...fullPost, status: "draft", version: 2 });
    updatePostMock.mockResolvedValue({ ...fullPost, status: "draft", version: 3, content: "Local edit" });
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByLabelText("Loaded article body");
    fireEvent.change(screen.getByLabelText("Loaded article body"), { target: { value: "Local edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Unpublish article" }));
    await screen.findByText(/Publication withdrawn/);
    expect(unpublishPostMock).toHaveBeenCalledWith(fullPost.id, 1);
    expect(screen.getByLabelText("Loaded article body")).toHaveValue("Local edit");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenCalledWith(fullPost.id, expect.objectContaining({ version: 2, content: "Local edit" })));
    await screen.findByText("All changes saved");
  });

  it("keeps conflicted text until the latest version is explicitly adopted", async () => {
    getAdminPostMock.mockResolvedValueOnce(fullPost).mockResolvedValue({ ...fullPost, version: 2, content: "Remote edit" });
    updatePostMock.mockRejectedValue(new ApiError("Changed", { kind: "http", status: 409, code: "post_version_conflict" }));
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByLabelText("Loaded article body");
    fireEvent.change(screen.getByLabelText("Loaded article body"), { target: { value: "Local edit" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load latest" }));
    const adopt = await screen.findByRole("button", { name: "Discard and use latest" });
    expect(screen.getByLabelText("Loaded article body")).toHaveValue("Local edit");
    expect(screen.getByRole("button", { name: "Save article" })).toBeDisabled();
    fireEvent.click(adopt);
    expect(screen.getByLabelText("Loaded article body")).toHaveValue("Remote edit");
    expect(screen.getByText("All changes saved")).toBeVisible();
    expect(updatePostMock).toHaveBeenCalledTimes(1);
  });

  it("preserves input on an expired save session and permits a manual retry", async () => {
    getAdminPostMock.mockResolvedValue(fullPost);
    updatePostMock.mockRejectedValueOnce(new ApiError("Expired", { kind: "http", status: 401 })).mockResolvedValue({ ...fullPost, version: 2 });
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByLabelText("Loaded article body");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await screen.findByText("Sign in again");
    expect(screen.getByLabelText("Loaded article body")).toHaveValue(fullPost.content);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await screen.findByText("✅ Saved successfully!");
    expect(screen.getByLabelText("Loaded article body")).toHaveValue(fullPost.content);
  });

  it("loads a fresh body and keeps published articles open after saving", async () => {
    const pending = pendingDetail();
    getAdminPostMock.mockReturnValue(pending.promise);
    updatePostMock.mockResolvedValue(fullPost);
    render(<EditorPageClient initialState={readyState} />);
    expect(getAdminPostMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    expect(screen.getByTestId("editor-list")).toBeVisible();
    expect(screen.queryByText("Loading article…")).not.toBeInTheDocument();
    expect(document.querySelector("[data-editor-view]" )).not.toHaveClass("fade-in");
    expect(screen.queryByRole("button", { name: "Save article" })).not.toBeInTheDocument();
    expect(getAdminPostMock).toHaveBeenCalledWith(7, { signal: expect.any(AbortSignal) });
    expect(createPostMock).not.toHaveBeenCalled();
    expect(updatePostMock).not.toHaveBeenCalled();

    await act(async () => pending.resolve(fullPost));
    expect(screen.getByTestId("editing-title")).toHaveTextContent("Fresh server title");
    expect(document.querySelector("[data-editor-view]" )).toHaveClass("fade-in");
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue(fullPost.content);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenCalledWith(7, expect.objectContaining({
      title: fullPost.title, content: fullPost.content, version: 1,
    })));
    await screen.findByText("✅ Saved successfully!");
    expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled();
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

  it("blocks returning to another article until a pending draft save finishes", async () => {
    getAdminPostsMock.mockResolvedValue({ data: readyState.posts.data, page: 1, limit: 10, total: 2 });
    const pending = pendingDetail();
    const draft = { ...fullPost, status: "draft" };
    getAdminPostMock.mockResolvedValue(draft);
    updatePostMock.mockReturnValueOnce(pending.promise).mockResolvedValue(draft);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByRole("button", { name: "Save article" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to content list" }));
    expect(screen.queryByTestId("editor-list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    expect(updatePostMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(draft));
    fireEvent.click(screen.getByRole("button", { name: "Back to content list" }));
    getAdminPostMock.mockResolvedValue({ ...draft, id: 8, title: "Another article" });
    fireEvent.click(screen.getByRole("button", { name: "Another article" }));
    await screen.findByRole("button", { name: "Save article" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenLastCalledWith(8, expect.objectContaining({ title: "Another article" })));
  });

  it("retains the created draft identity when saving again", async () => {
    const draft = { ...fullPost, status: "draft" };
    createPostMock.mockResolvedValue(draft);
    updatePostMock.mockResolvedValue(draft);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: "New article" }));
    fireEvent.change(screen.getByLabelText("Article title"), { target: { value: fullPost.title } });
    fireEvent.change(screen.getByLabelText("Loaded article body"), { target: { value: fullPost.content } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await screen.findByText("✅ Saved successfully!");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenCalledWith(draft.id, expect.objectContaining({ content: draft.content })));
    expect(createPostMock).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"])("ignores a save %s after the editor unmounts", async outcome => {
    let resolve!: (post: PostDetail) => void;
    let reject!: (error: Error) => void;
    updatePostMock.mockReturnValue(new Promise<PostDetail>((yes, no) => { resolve = yes; reject = no; }));
    getAdminPostMock.mockResolvedValue(fullPost);
    const view = render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByRole("button", { name: "Save article" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    view.unmount();
    getAdminPostsMock.mockClear();
    window.history.replaceState(null, "", "/search?q=keep");
    await act(async () => { if (outcome === "success") resolve(fullPost); else reject(new Error("Offline")); });
    expect(window.location.pathname + window.location.search).toBe("/search?q=keep");
    expect(getAdminPostsMock).not.toHaveBeenCalled();
  });

  it("retains input after a failed save and allows a retry", async () => {
    getAdminPostMock.mockResolvedValue(fullPost);
    updatePostMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(fullPost);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    await screen.findByRole("button", { name: "Save article" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await screen.findByText("❌ Failed to save post.");
    expect(screen.getByLabelText("Loaded article body")).toHaveValue(fullPost.content);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await screen.findByText("✅ Saved successfully!");
    expect(updatePostMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a cancelled read and ignores its late response after another article loads", async () => {
    const old = pendingDetail();
    const current = pendingDetail();
    getAdminPostMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    const oldSignal = getAdminPostMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
    view.rerender(<EditorPageClient initialState={readyState} />);
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Another article" }));
    await act(async () => current.resolve({ ...fullPost, id: 8, title: "Current article", content: "Current body" }));
    await act(async () => old.resolve(fullPost));
    expect(screen.getByTestId("editing-title")).toHaveTextContent("Current article");
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue("Current body");
    expect(updatePostMock).not.toHaveBeenCalled();
  });

  it("switches pending articles without applying the previous response", async () => {
    const old = pendingDetail();
    const current = pendingDetail();
    getAdminPostMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    const signal = getAdminPostMock.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Another article" }));
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(fullPost));
    expect(screen.getByTestId("editor-list")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save article" })).not.toBeInTheDocument();
    await act(async () => current.resolve({ ...fullPost, id: 8, title: "Latest target" }));
    expect(screen.getByTestId("editing-title")).toHaveTextContent("Latest target");
  });

  it("starts a new draft without a detail request", () => {
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: "New article" }));
    expect(screen.getByRole("textbox", { name: "Loaded article body" })).toHaveValue("");
    expect(getAdminPostMock).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("edit")).toBe("new");
  });

  it("opens a saved article directly from the URL without first showing the list", async () => {
    window.history.replaceState(null, "", "/editor?edit=7");
    getAdminPostMock.mockResolvedValue(fullPost);
    render(<EditorPageClient initialState={readyState} />);
    expect(screen.queryByTestId("editor-list")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Loaded article body")).toHaveValue(fullPost.content);
    expect(getAdminPostMock).toHaveBeenCalledWith(7, { signal: expect.any(AbortSignal) });
  });

  it("keeps the saved draft mounted while the router catches up with native history", async () => {
    window.history.replaceState(null, "", "/editor?edit=new&draft=handoff");
    navigationState.delayedParams = new URLSearchParams(window.location.search);
    createPostMock.mockResolvedValue({ ...fullPost, status: "draft" });
    getAdminPostsMock.mockResolvedValue({ data: readyState.posts.data, page: 1, limit: 10, total: 2 });
    const view = render(<EditorPageClient initialState={readyState} />);
    const title = screen.getByLabelText("Article title");
    const body = screen.getByLabelText("Loaded article body");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.change(title, { target: { value: fullPost.title } });
    fireEvent.change(body, { target: { value: fullPost.content } });
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("edit")).toBe("7"));
    expect(title).toHaveValue(fullPost.title);
    expect(body).toHaveValue(fullPost.content);
    navigationState.delayedParams = null;
    view.rerender(<EditorPageClient initialState={readyState} />);
    expect(screen.getByLabelText("Article title")).toBe(title);
    expect(screen.getByLabelText("Loaded article body")).toBe(body);
    expect(getAdminPostMock).not.toHaveBeenCalled();
  });

  it("uses a matching server article immediately and clears it when identity changes", async () => {
    window.history.replaceState(null, "", "/editor?edit=7");
    const initialState = { ...readyState, post: fullPost };
    const view = render(<EditorPageClient initialState={initialState} />);
    expect(screen.getByLabelText("Loaded article body")).toHaveValue(fullPost.content);
    expect(getAdminPostMock).not.toHaveBeenCalled();
    getAdminPostMock.mockReturnValue(new Promise(() => {}));
    navigationState.userId = 2;
    view.rerender(<EditorPageClient initialState={initialState} />);
    expect(screen.queryByLabelText("Loaded article body")).not.toBeInTheDocument();
    await waitFor(() => expect(getAdminPostMock).toHaveBeenCalledWith(7, { signal: expect.any(AbortSignal) }));
  });

  it("does not use a server article that belongs to another URL target", async () => {
    window.history.replaceState(null, "", "/editor?edit=8");
    getAdminPostMock.mockResolvedValue({ ...fullPost, id: 8, content: "Requested body" });
    render(<EditorPageClient initialState={{ ...readyState, post: fullPost }} />);
    expect(screen.queryByLabelText("Loaded article body")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Loaded article body")).toHaveValue("Requested body");
  });

  it("opens the new article form from its URL without a saved article read", () => {
    window.history.replaceState(null, "", "/editor?edit=new");
    render(<EditorPageClient initialState={readyState} />);
    expect(screen.queryByTestId("editor-list")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loaded article body")).toHaveValue("");
    expect(getAdminPostMock).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("ignores a pending save %s after history switches to a different article", async outcome => {
    let resolve!: (post: PostDetail) => void;
    let reject!: (error: Error) => void;
    updatePostMock.mockReturnValue(new Promise<PostDetail>((yes, no) => { resolve = yes; reject = no; }));
    getAdminPostMock.mockResolvedValueOnce(fullPost).mockResolvedValueOnce({ ...fullPost, id: 8, title: "Article B", content: "Body B" });
    window.history.replaceState(null, "", "/editor?edit=7");
    const view = render(<EditorPageClient initialState={readyState} />);
    await screen.findByRole("button", { name: "Save article" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    window.history.replaceState(null, "", "/editor?edit=8");
    view.rerender(<EditorPageClient initialState={readyState} />);
    await waitFor(() => expect(screen.getByLabelText("Loaded article body")).toHaveValue("Body B"));
    await act(async () => { if (outcome === "success") resolve(fullPost); else reject(new Error("Offline")); });
    expect(screen.getByLabelText("Loaded article body")).toHaveValue("Body B");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled();
    expect(new URLSearchParams(window.location.search).get("edit")).toBe("8");
    updatePostMock.mockResolvedValue({ ...fullPost, id: 8 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save article" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save article" }));
    await waitFor(() => expect(updatePostMock).toHaveBeenLastCalledWith(8, expect.objectContaining({ title: "Article B", content: "Body B" })));
  });

  it("does not show a cancelled request failure after returning to the list", async () => {
    let reject!: (error: Error) => void;
    getAdminPostMock.mockReturnValue(new Promise<PostDetail>((_resolve, fail) => { reject = fail; }));
    render(<EditorPageClient initialState={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: recoveredPost.title }));
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));
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
