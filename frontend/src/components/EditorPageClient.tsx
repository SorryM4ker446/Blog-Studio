"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { Category, FileRecord, PostDetail, PostSummary } from "@/lib/api";
import {
  createCategory,
  createPost,
  deleteCategory,
  deleteFile,
  deletePost,
  getApiErrorMessage,
  getAdminCategories,
  getAdminFiles,
  getAdminPosts,
  getFileViewUrl,
  normalizeMarkdownFileUrls,
  searchAdminResources,
  updateCategory,
  updateFileMetadata,
  updatePost,
  uploadFile,
  uploadFileWithMetadata,
} from "@/lib/api";
import { readResourceQuery, readEditorTab, resourceURL, setResourceQuery, writeResourceQuery, type ResourceQuery } from "@/lib/resource-query";
import { useResourcePage } from "@/lib/use-resource-page";
import EditorDeleteDialog from "@/components/editor/EditorDeleteDialog";
import EditorListView, { type EditorTab } from "@/components/editor/EditorListView";
import PostEditorForm from "@/components/editor/PostEditorForm";
import PostDetailLoader from "@/components/editor/PostDetailLoader";
import { FileEditDialog, FilePreviewDialog, FileUploadDialog } from "@/components/files/FileDialogs";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";

type ViewMode = "list" | "edit";
type DeleteType = "post" | "file" | "category";

export interface PostListSnapshot {
  data: PostSummary[];
  page: number;
  totalPages: number;
  total: number;
}

export interface FileListSnapshot {
  data: FileRecord[];
  page: number;
  totalPages: number;
  total: number;
}

export interface EditorPageInitialState {
  posts: PostListSnapshot;
  files: FileListSnapshot;
  postQuery: ResourceQuery;
  fileQuery: ResourceQuery;
  categories: Category[];
  postsError: string;
  filesError: string;
  categoriesError: string;
}

export default function EditorPageClient({ initialState }: { initialState: EditorPageInitialState }) {
  const { user, isLoading, authStatus, authError, refreshAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab: EditorTab = readEditorTab(searchParams);
  const searchQuery = readResourceQuery(searchParams).query;

  const isMountedRef = useRef(true);
  const categoryRequestIdRef = useRef(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRecoveryRef = useRef({ categories: Boolean(initialState.categoriesError), posts: Boolean(initialState.postsError), files: Boolean(initialState.filesError) });
  const postQuery = useMemo(() => readResourceQuery(searchParams, "posts", "post_page"), [searchParams]);
  const fileQuery = useMemo(() => readResourceQuery(searchParams, "files", "file_page"), [searchParams]);
  const loadPostPage = useCallback(async (target: ResourceQuery) => {
    const result = target.query ? await searchAdminResources(target, false) : await getAdminPosts(target.page, 10, "admin", target.categoryId);
    return { data: "posts" in result ? result.posts : result.data, total: "posts_total" in result ? result.posts_total : result.total,
      page: result.page, totalPages: Math.max(1, Math.ceil(result.total / result.limit)), error: "" };
  }, []);
  const loadFilePage = useCallback(async (target: ResourceQuery) => {
    const result = target.query ? await searchAdminResources(target, false) : await getAdminFiles(target.page, 10, false);
    return { data: "files" in result ? result.files : result.data, total: "files_total" in result ? result.files_total : result.total,
      page: result.page, totalPages: Math.max(1, Math.ceil(result.total / result.limit)), error: "" };
  }, []);
  const authorized = authStatus === "authenticated" && user?.role === "admin";
  const postResource = useResourcePage({ ...initialState.posts, error: initialState.postsError }, initialState.postQuery, postQuery,
    loadPostPage, "/editor", "post_page", authorized && urlTab === "posts");
  const fileResource = useResourcePage({ ...initialState.files, error: initialState.filesError }, initialState.fileQuery, fileQuery,
    loadFilePage, "/editor", "file_page", authorized && urlTab === "files");
  const { data: posts, total: postCount, page: postPage, totalPages: postTotalPages, error: postsError } = postResource.state;
  const { data: files, total: fileCount, page: filePage, totalPages: fileTotalPages, error: filesError } = fileResource.state;
  const postsLoading = postResource.loading;
  const filesLoading = fileResource.loading;
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [categories, setCategories] = useState<Category[]>(initialState.categories);
  const [categoriesLoading, setCategoriesLoading] = useState(Boolean(initialState.categoriesError));
  const [categoriesError, setCategoriesError] = useState(initialState.categoriesError);
  const [editingPost, setEditingPost] = useState<PostDetail | null>(null);
  const [postToLoad, setPostToLoad] = useState<PostSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategoryId, setEditCategoryId] = useState(0);
  const [editStatus, setEditStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [metadataFile, setMetadataFile] = useState<FileRecord | null>(null);

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: DeleteType;
    id: number | null;
    busy: boolean;
  }>({ open: false, type: "post", id: null, busy: false });
  const [deleteError, setDeleteError] = useState("");
  const [deleteErrorCode, setDeleteErrorCode] = useState("");

  function notifyUpdate() {
    window.dispatchEvent(new CustomEvent("blog:refresh-sidebar"));
  }

  useEffect(() => {
    if (!isLoading && authStatus === "anonymous") router.replace("/login?redirect=/editor");
  }, [authStatus, isLoading, router]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  async function loadCategories() {
    const requestId = ++categoryRequestIdRef.current;
    setCategoriesLoading(true);
    setCategoriesError("");
    try {
      const result = await getAdminCategories();
      if (isMountedRef.current && requestId === categoryRequestIdRef.current) setCategories(result);
    } catch (error) {
      if (isMountedRef.current && requestId === categoryRequestIdRef.current) {
        setCategoriesError(getApiErrorMessage(error, "Failed to load categories."));
      }
    } finally {
      if (isMountedRef.current && requestId === categoryRequestIdRef.current) setCategoriesLoading(false);
    }
  }

  const recoveryActions = useRef({ loadCategories, posts: postResource.retry, files: fileResource.retry });
  recoveryActions.current = { loadCategories, posts: postResource.retry, files: fileResource.retry };
  useEffect(() => {
    if (!authorized) return;
    const recovery = initialRecoveryRef.current;
    initialRecoveryRef.current = { categories: false, posts: false, files: false };
    if (recovery.categories) void recoveryActions.current.loadCategories();
    if (recovery.posts) void recoveryActions.current.posts();
    if (recovery.files) void recoveryActions.current.files();
  }, [authorized]);

  function readCurrentLocation() {
    const params = new URLSearchParams(window.location.search);
    return { params, query: (params.get("q") || "").trim(), tab: (params.get("tab") === "files" ? "files" : "posts") as EditorTab };
  }
  async function refreshPosts(pageToLoad = postPage) {
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "posts", "post_page"), page: pageToLoad };
    if (readCurrentLocation().tab === "posts") writeResourceQuery("/editor", target, { replace: true, pageKey: "post_page" });
    await postResource.run(target);
  }
  async function refreshFiles(pageToLoad = filePage) {
    const target = { ...readResourceQuery(new URLSearchParams(window.location.search), "files", "file_page"), page: pageToLoad };
    if (readCurrentLocation().tab === "files") writeResourceQuery("/editor", target, { replace: true, pageKey: "file_page" });
    await fileResource.run(target);
  }
  function navigateList(tab: EditorTab, patch: Partial<ResourceQuery>) {
    const { params } = readCurrentLocation();
    const pageKey = tab === "posts" ? "post_page" : "file_page";
    const target = { ...readResourceQuery(params, tab, pageKey), ...patch };
    params.set("tab", tab);
    setResourceQuery(params, target, pageKey);
    const url = resourceURL("/editor", params);
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", url);
    void (tab === "posts" ? postResource.run(target) : fileResource.run(target));
  }
  function handleSearch(query: string) { navigateList(readCurrentLocation().tab, { query: query.trim(), page: 1 }); }
  function handleTabChange(tab: EditorTab) {
    const { params, tab: previousTab, query: previousQuery } = readCurrentLocation();
    const hadFilter = Boolean(previousQuery || params.get("category"));
    params.set("tab", tab);
    params.delete("q");
    params.delete("category");
    params.delete(tab === "posts" ? "post_page" : "file_page");
    const url = resourceURL("/editor", params);
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", url);
    if (tab !== previousTab && hadFilter) {
      const previousPageKey = previousTab === "posts" ? "post_page" : "file_page";
      const defaults = readResourceQuery(params, previousTab, previousPageKey);
      void (previousTab === "posts" ? postResource.run(defaults) : fileResource.run(defaults));
    }
  }
  function handlePageChange(tab: EditorTab, page: number) { navigateList(tab, { page }); }

  const applyPostDetail = useCallback((post: PostDetail) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditSummary(post.summary);
    setEditContent(normalizeMarkdownFileUrls(post.content));
    setEditCategoryId(post.category_id ?? 0);
    setEditStatus(post.status);
    setPostToLoad(null);
  }, []);

  function openEditor(post: PostSummary | null) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setPostToLoad(post);
    setEditingPost(null);
    setEditTitle("");
    setEditSummary("");
    setEditContent("");
    setEditCategoryId(0);
    setEditStatus("draft");
    setSaveMessage("");
    setViewMode("edit");
  }

  async function handleSave() {
    if (postToLoad || saving) return;
    if (!editTitle.trim() || !editContent.trim()) {
      setSaveMessage("❌ Title and content are required.");
      if (!editTitle.trim()) document.getElementById("post-title")?.focus();
      else document.querySelector<HTMLElement>(".custom-editor-wrapper textarea")?.focus();
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        title: editTitle.trim(),
        summary: editSummary,
        content: editContent,
        category_id: editCategoryId || 0,
        status: editStatus,
      };
      const result = editingPost ? await updatePost(editingPost.id, payload) : await createPost(payload);
      if (!result) throw new Error("Failed to save post.");
      setSaveMessage("✅ Saved successfully!");
      await refreshPosts(editingPost ? postPage : 1);
      notifyUpdate();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setViewMode("list");
      }, 600);
    } catch (error) {
      setSaveMessage(`❌ ${getApiErrorMessage(error, "Failed to save post.")}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCategory(name: string): Promise<string | null> {
    try {
      const category = await createCategory(name);
      if (!category) return "Failed to create category.";
      setCategories((current) => [...current, category]);
      setEditCategoryId(category.id);
      notifyUpdate();
      return null;
    } catch (error) {
      return getApiErrorMessage(error, "Failed to create category.");
    }
  }

  async function handleRenameCategory(id: number, name: string): Promise<string | null> {
    try {
      const updated = await updateCategory(id, name);
      if (!updated) return "Failed to rename category.";
      await loadCategories();
      notifyUpdate();
      return null;
    } catch (error) {
      return getApiErrorMessage(error, "Failed to rename category.");
    }
  }

  function openDelete(type: DeleteType, id: number) {
    setDeleteError("");
    setDeleteErrorCode("");
    setDeleteDialog({ open: true, type, id, busy: false });
  }

  function closeDelete() {
    if (deleteDialog.busy) return;
    setDeleteError("");
    setDeleteErrorCode("");
    setDeleteDialog({ open: false, type: "post", id: null, busy: false });
  }

  async function executeDelete() {
    if (!deleteDialog.id || deleteDialog.busy || deleteErrorCode === "file_in_use") return;
    const { id, type } = deleteDialog;
    setDeleteDialog((current) => ({ ...current, busy: true }));
    setDeleteError("");
    setDeleteErrorCode("");
    try {
      if (type === "post") {
        const deleted = await deletePost(id);
        if (!deleted) throw new Error("Failed to delete post.");
        if (editingPost?.id === id) {
          setEditingPost(null);
          setViewMode("list");
        }
        await refreshPosts(postPage);
      } else if (type === "file") {
        const result = await deleteFile(id);
        if (!result.ok) {
          setDeleteError(result.error || "Failed to delete file.");
          setDeleteErrorCode(result.code || "");
          setDeleteDialog((current) => ({ ...current, busy: false }));
          return;
        }
        await refreshFiles(filePage);
      } else {
        const deleted = await deleteCategory(id);
        if (!deleted) throw new Error("Failed to delete category.");
        if (editCategoryId === id) setEditCategoryId(0);
        await Promise.all([loadCategories(), refreshPosts(postPage)]);
      }
      notifyUpdate();
      setDeleteDialog({ open: false, type: "post", id: null, busy: false });
    } catch (error) {
      setDeleteError(getApiErrorMessage(error, `Failed to delete ${type}.`));
      setDeleteDialog((current) => ({ ...current, busy: false }));
    }
  }

  async function handleManagedFileUpload(file: File, displayName: string, description: string) {
    const result = await uploadFileWithMetadata(file, { displayName, description });
    if (result.ok && result.file) {
      await refreshFiles(1);
      notifyUpdate();
    }
    return result;
  }

  async function handleFileMetadataSave(file: FileRecord, displayName: string, description: string) {
    const result = await updateFileMetadata(file.id, displayName, description);
    if (result.ok && result.file) {
      const updated = result.file;
      setPreviewFile((current) => current?.id === updated.id ? updated : current);
      await refreshFiles(filePage);
      notifyUpdate();
    }
    return result;
  }

  async function handleImageUpload(file: File): Promise<string> {
    const uploaded = await uploadFile(file, true);
    if (!uploaded) throw new Error("Failed to upload image.");
    return getFileViewUrl(uploaded.id);
  }

  if (isLoading || authStatus === "checking" || authStatus === "anonymous") {
    return <LoadingState label="Checking editor access…" rows={3} />;
  }
  if (authStatus === "unavailable") {
    return (
      <ErrorState
        title="Editor access could not be verified"
        message={getApiErrorMessage(authError, "The server could not verify your session.")}
        onRetry={() => void refreshAuth()}
      />
    );
  }
  if (!user || user.role !== "admin") {
    return <ErrorState title="Administrator access required" message="This account cannot access the content editor." />;
  }

  return (
    <>
      {viewMode === "list" ? (
        <EditorListView
          activeTab={urlTab}
          searchQuery={searchQuery}
          posts={posts}
          files={files}
          postCount={postCount}
          fileCount={fileCount}
          postsLoading={postsLoading}
          filesLoading={filesLoading}
          postsError={postsError}
          filesError={filesError}
          postPage={postPage}
          postTotalPages={postTotalPages}
          filePage={filePage}
          fileTotalPages={fileTotalPages}
          onTabChange={handleTabChange}
          onSearch={handleSearch}
          onNewPost={() => openEditor(null)}
          onUploadFile={() => setUploadDialogOpen(true)}
          onViewPost={(post) => post.status === "published" ? router.push(`/posts/${post.id}`) : openEditor(post)}
          onEditPost={openEditor}
          onDeletePost={(id) => openDelete("post", id)}
          onPreviewFile={setPreviewFile}
          onEditFile={setMetadataFile}
          onDeleteFile={(id) => openDelete("file", id)}
          onLoadPosts={(page) => handlePageChange("posts", page)}
          onLoadFiles={(page) => handlePageChange("files", page)}
          onRetryPosts={() => { void postResource.retry(); }}
          onRetryFiles={() => { void fileResource.retry(); }}
          categories={categories}
          categoryId={postQuery.categoryId}
          onCategoryChange={(categoryId) => navigateList("posts", { categoryId, page: 1 })}
        />
      ) : postToLoad ? (
        <PostDetailLoader
          key={postToLoad.id}
          postId={postToLoad.id}
          onLoaded={applyPostDetail}
          onBack={() => setViewMode("list")}
        />
      ) : (
        <PostEditorForm
          editingPost={editingPost}
          title={editTitle}
          summary={editSummary}
          content={editContent}
          categoryId={editCategoryId}
          status={editStatus}
          categories={categories}
          categoriesLoading={categoriesLoading}
          categoriesError={categoriesError}
          saving={saving}
          saveMessage={saveMessage}
          onTitleChange={setEditTitle}
          onSummaryChange={setEditSummary}
          onContentChange={setEditContent}
          onCategoryChange={setEditCategoryId}
          onStatusChange={setEditStatus}
          onBack={() => setViewMode("list")}
          onSave={handleSave}
          onCreateCategory={handleCreateCategory}
          onRenameCategory={handleRenameCategory}
          onDeleteCategory={(id) => openDelete("category", id)}
          onRetryCategories={() => void loadCategories()}
          onImageUpload={handleImageUpload}
        />
      )}

      {uploadDialogOpen && <FileUploadDialog open onClose={() => setUploadDialogOpen(false)} onUpload={handleManagedFileUpload} />}
      <FilePreviewDialog
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onEdit={(file) => {
          setPreviewFile(null);
          setMetadataFile(file);
        }}
      />
      {metadataFile && (
        <FileEditDialog key={metadataFile.id} file={metadataFile} onClose={() => setMetadataFile(null)} onSave={handleFileMetadataSave} />
      )}
      <EditorDeleteDialog
        open={deleteDialog.open}
        resourceType={deleteDialog.type}
        busy={deleteDialog.busy}
        blocked={deleteErrorCode === "file_in_use"}
        error={deleteError}
        onConfirm={() => void executeDelete()}
        onCancel={closeDelete}
      />
    </>
  );
}
