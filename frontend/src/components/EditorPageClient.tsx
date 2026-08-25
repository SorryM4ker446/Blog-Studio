"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { Category, FileRecord, Post } from "@/lib/api";
import {
  createCategory,
  createPost,
  deleteCategory,
  deleteFile,
  deletePost,
  filterPostsByVisibleText,
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
import EditorDeleteDialog from "@/components/editor/EditorDeleteDialog";
import EditorListView, { type EditorTab } from "@/components/editor/EditorListView";
import PostEditorForm from "@/components/editor/PostEditorForm";
import { FileEditDialog, FilePreviewDialog, FileUploadDialog } from "@/components/files/FileDialogs";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";

type ViewMode = "list" | "edit";
type DeleteType = "post" | "file" | "category";

export interface PostListSnapshot {
  data: Post[];
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
  postDefault: PostListSnapshot;
  fileDefault: FileListSnapshot;
  categories: Category[];
  postsError: string;
  filesError: string;
  categoriesError: string;
  postViewQuery: string | null;
  fileViewQuery: string | null;
}

export default function EditorPageClient({ initialState }: { initialState: EditorPageInitialState }) {
  const { user, isLoading, authStatus, authError, refreshAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab: EditorTab = searchParams.get("tab") === "files" ? "files" : "posts";
  const searchQuery = searchParams.get("q") || "";

  const isMountedRef = useRef(true);
  const categoryRequestIdRef = useRef(0);
  const postRequestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const postDefaultRequestIdRef = useRef(0);
  const fileDefaultRequestIdRef = useRef(0);
  const postDefaultSnapshotRef = useRef<PostListSnapshot | null>(initialState.postDefault);
  const fileDefaultSnapshotRef = useRef<FileListSnapshot | null>(initialState.fileDefault);
  const postViewQueryRef = useRef<string | null>(initialState.postViewQuery);
  const fileViewQueryRef = useRef<string | null>(initialState.fileViewQuery);
  const postViewPageRef = useRef(initialState.posts.page);
  const fileViewPageRef = useRef(initialState.files.page);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRecoveryRef = useRef<{
    categories: boolean;
    posts: boolean;
    files: boolean;
    query: string;
    tab: EditorTab;
    postPage: number;
    filePage: number;
  } | null>({
    categories: Boolean(initialState.categoriesError),
    posts: Boolean(initialState.postsError),
    files: Boolean(initialState.filesError),
    query: searchQuery.trim(),
    tab: urlTab,
    postPage: initialState.posts.page,
    filePage: initialState.files.page,
  });
  const recoveryActionsRef = useRef<{
    loadCategories: () => Promise<void>;
    loadPosts: (page: number) => Promise<void>;
    loadFiles: (page: number) => Promise<void>;
    runSearch: (query: string, tab: EditorTab) => Promise<void>;
  } | null>(null);
  const reconcileHistoryRef = useRef<(params: URLSearchParams) => void>(() => undefined);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [posts, setPosts] = useState<Post[]>(initialState.posts.data);
  const [files, setFiles] = useState<FileRecord[]>(initialState.files.data);
  const [categories, setCategories] = useState<Category[]>(initialState.categories);
  const [categoriesLoading, setCategoriesLoading] = useState(Boolean(initialState.categoriesError));
  const [categoriesError, setCategoriesError] = useState(initialState.categoriesError);
  const [postsLoading, setPostsLoading] = useState(Boolean(initialState.postsError));
  const [filesLoading, setFilesLoading] = useState(Boolean(initialState.filesError));
  const [postsError, setPostsError] = useState(initialState.postsError);
  const [filesError, setFilesError] = useState(initialState.filesError);
  const [postCount, setPostCount] = useState<number | null>(initialState.posts.total);
  const [fileCount, setFileCount] = useState<number | null>(initialState.files.total);

  const [editingPost, setEditingPost] = useState<Post | null>(null);
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
  const [postPage, setPostPage] = useState(initialState.posts.page);
  const [postTotalPages, setPostTotalPages] = useState(initialState.posts.totalPages);
  const [filePage, setFilePage] = useState(initialState.files.page);
  const [fileTotalPages, setFileTotalPages] = useState(initialState.files.totalPages);

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

  async function loadPosts(pageToLoad: number) {
    postViewQueryRef.current = null;
    postViewPageRef.current = pageToLoad;
    const defaultRequestId = ++postDefaultRequestIdRef.current;
    const requestId = ++postRequestIdRef.current;
    setPostsLoading(true);
    setPostsError("");
    try {
      const result = await getAdminPosts(pageToLoad, 10, "admin");
      if (!isMountedRef.current) return;
      const snapshot = {
        data: result.data,
        page: result.page,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
        total: result.total,
      };
      if (defaultRequestId === postDefaultRequestIdRef.current) postDefaultSnapshotRef.current = snapshot;
      if (requestId !== postRequestIdRef.current) return;
      showPostSnapshot(snapshot);
    } catch (error) {
      if (isMountedRef.current && requestId === postRequestIdRef.current) {
        setPostsError(getApiErrorMessage(error, "Failed to load posts."));
      }
    } finally {
      if (isMountedRef.current && requestId === postRequestIdRef.current) setPostsLoading(false);
    }
  }

  async function loadFiles(pageToLoad: number) {
    fileViewQueryRef.current = null;
    fileViewPageRef.current = pageToLoad;
    const defaultRequestId = ++fileDefaultRequestIdRef.current;
    const requestId = ++fileRequestIdRef.current;
    setFilesLoading(true);
    setFilesError("");
    try {
      const result = await getAdminFiles(pageToLoad, 10, false);
      if (!isMountedRef.current) return;
      const snapshot = {
        data: result.data,
        page: result.page,
        totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
        total: result.total,
      };
      if (defaultRequestId === fileDefaultRequestIdRef.current) fileDefaultSnapshotRef.current = snapshot;
      if (requestId !== fileRequestIdRef.current) return;
      showFileSnapshot(snapshot);
    } catch (error) {
      if (isMountedRef.current && requestId === fileRequestIdRef.current) {
        setFilesError(getApiErrorMessage(error, "Failed to load files."));
      }
    } finally {
      if (isMountedRef.current && requestId === fileRequestIdRef.current) setFilesLoading(false);
    }
  }

  async function runSearch(query: string, tab: EditorTab) {
    if (tab === "posts") {
      postViewQueryRef.current = query;
      postViewPageRef.current = 1;
    } else {
      fileViewQueryRef.current = query;
      fileViewPageRef.current = 1;
    }
    const requestIdRef = tab === "posts" ? postRequestIdRef : fileRequestIdRef;
    const requestId = ++requestIdRef.current;
    const setLoading = tab === "posts" ? setPostsLoading : setFilesLoading;
    const setError = tab === "posts" ? setPostsError : setFilesError;
    setLoading(true);
    setError("");
    try {
      const result = await searchAdminResources(query, tab, false);
      if (!isMountedRef.current || requestId !== requestIdRef.current) return;
      if (tab === "posts") {
        const visiblePosts = filterPostsByVisibleText(result.posts || [], query);
        setPosts(visiblePosts);
        setPostCount(visiblePosts.length);
        setPostPage(1);
        setPostTotalPages(1);
      } else {
        const matchingFiles = result.files || [];
        setFiles(matchingFiles);
        setFileCount(matchingFiles.length);
        setFilePage(1);
        setFileTotalPages(1);
      }
    } catch (error) {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setError(getApiErrorMessage(error, `Failed to search ${tab}.`));
      }
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }

  recoveryActionsRef.current = { loadCategories, loadPosts, loadFiles, runSearch };

  useEffect(() => {
    if (authStatus !== "authenticated" || user?.role !== "admin") return;
    const recovery = initialRecoveryRef.current;
    const actions = recoveryActionsRef.current;
    if (!recovery || !actions) return;
    initialRecoveryRef.current = null;

    if (recovery.categories) void actions.loadCategories();
    if (recovery.posts) {
      if (recovery.query && recovery.tab === "posts") void actions.runSearch(recovery.query, "posts");
      else void actions.loadPosts(recovery.postPage);
    }
    if (recovery.files) {
      if (recovery.query && recovery.tab === "files") void actions.runSearch(recovery.query, "files");
      else void actions.loadFiles(recovery.filePage);
    }
  }, [authStatus, user]);

  function showPostSnapshot(snapshot: PostListSnapshot) {
    setPosts(snapshot.data);
    setPostCount(snapshot.total);
    setPostPage(snapshot.page);
    setPostTotalPages(snapshot.totalPages);
  }

  function showFileSnapshot(snapshot: FileListSnapshot) {
    setFiles(snapshot.data);
    setFileCount(snapshot.total);
    setFilePage(snapshot.page);
    setFileTotalPages(snapshot.totalPages);
  }

  function restoreDefaultView(tab: EditorTab) {
    const viewQueryRef = tab === "posts" ? postViewQueryRef : fileViewQueryRef;
    if (viewQueryRef.current === null) return;

    if (tab === "posts") {
      const snapshot = postDefaultSnapshotRef.current;
      if (snapshot) showPostSnapshot(snapshot);
      void loadPosts(snapshot?.page || 1);
    } else {
      const snapshot = fileDefaultSnapshotRef.current;
      if (snapshot) showFileSnapshot(snapshot);
      void loadFiles(snapshot?.page || 1);
    }
  }

  function readCurrentLocation() {
    const params = new URLSearchParams(window.location.search);
    return {
      params,
      query: (params.get("q") || "").trim(),
      tab: (params.get("tab") === "files" ? "files" : "posts") as EditorTab,
    };
  }

  reconcileHistoryRef.current = (params) => {
    const tab: EditorTab = params.get("tab") === "files" ? "files" : "posts";
    const query = (params.get("q") || "").trim();
    const viewQueryRef = tab === "posts" ? postViewQueryRef : fileViewQueryRef;
    if (query) {
      if (viewQueryRef.current !== query) void runSearch(query, tab);
      return;
    }
    if (viewQueryRef.current !== null) {
      restoreDefaultView(tab);
      return;
    }

    const pageParam = tab === "posts" ? params.get("post_page") : params.get("file_page");
    const parsedPage = Number.parseInt(pageParam || "1", 10);
    const targetPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    if (tab === "posts") {
      if (postViewPageRef.current !== targetPage) void loadPosts(targetPage);
    } else if (fileViewPageRef.current !== targetPage) {
      void loadFiles(targetPage);
    }
  };

  useEffect(() => {
    reconcileHistoryRef.current(new URLSearchParams(searchParams.toString()));
  }, [searchParams]);

  async function refreshPosts(pageToLoad = postPage) {
    const { query } = readCurrentLocation();
    if (query) await runSearch(query, "posts");
    else await loadPosts(pageToLoad);
  }

  async function refreshFiles(pageToLoad = filePage) {
    const { query } = readCurrentLocation();
    if (query) await runSearch(query, "files");
    else await loadFiles(pageToLoad);
  }

  function handleSearch(query: string) {
    const normalized = query.trim();
    const { params, query: currentQuery, tab: currentTab } = readCurrentLocation();
    if (normalized === currentQuery) {
      if (normalized) void runSearch(normalized, currentTab);
      else if (currentTab === "posts") void loadPosts(1);
      else void loadFiles(1);
      return;
    }
    if (normalized) void runSearch(normalized, currentTab);
    else if (currentQuery) restoreDefaultView(currentTab);
    params.set("tab", currentTab);
    if (normalized) params.set("q", normalized);
    else params.delete("q");
    window.history.pushState(null, "", `/editor?${params.toString()}`);
  }

  function handleTabChange(tab: EditorTab) {
    const { params, query: currentQuery, tab: currentTab } = readCurrentLocation();
    if (tab === currentTab && !currentQuery) return;
    if (currentQuery) restoreDefaultView(currentTab);
    params.set("tab", tab);
    params.delete("q");
    window.history.pushState(null, "", `/editor?${params.toString()}`);
  }

  function handlePageChange(tab: EditorTab, page: number) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    params.delete("q");
    params.set(tab === "posts" ? "post_page" : "file_page", page.toString());
    window.history.pushState(null, "", `/editor?${params.toString()}`);
    if (tab === "posts") void loadPosts(page);
    else void loadFiles(page);
  }

  function openEditor(post: Post | null) {
    setEditingPost(post);
    setEditTitle(post?.title || "");
    setEditSummary(post?.summary || "");
    setEditContent(normalizeMarkdownFileUrls(post?.content || ""));
    setEditCategoryId(post?.category_id ?? 0);
    setEditStatus(post?.status || "draft");
    setSaveMessage("");
    setViewMode("edit");
  }

  async function handleSave() {
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
      setFiles((current) => current.map((item) => item.id === updated.id ? updated : item));
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
          onRetryPosts={() => {
            const { query } = readCurrentLocation();
            if (query) void runSearch(query, "posts");
            else void loadPosts(postPage);
          }}
          onRetryFiles={() => {
            const { query } = readCurrentLocation();
            if (query) void runSearch(query, "files");
            else void loadFiles(filePage);
          }}
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
