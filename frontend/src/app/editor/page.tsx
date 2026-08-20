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

interface PostListSnapshot {
  data: Post[];
  page: number;
  totalPages: number;
  total: number;
}

interface FileListSnapshot {
  data: FileRecord[];
  page: number;
  totalPages: number;
  total: number;
}

export default function EditorPage() {
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
  const postDefaultSnapshotRef = useRef<PostListSnapshot | null>(null);
  const fileDefaultSnapshotRef = useRef<FileListSnapshot | null>(null);
  const initializedRef = useRef(false);
  const postViewQueryRef = useRef<string | null>(null);
  const fileViewQueryRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<EditorTab>(urlTab);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [postsLoading, setPostsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [filesError, setFilesError] = useState("");
  const [postCount, setPostCount] = useState<number | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);

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
  const [postPage, setPostPage] = useState(1);
  const [postTotalPages, setPostTotalPages] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [fileTotalPages, setFileTotalPages] = useState(1);

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

  useEffect(() => {
    if (!user) {
      initializedRef.current = false;
      return;
    }

    setActiveTab(urlTab);

    const firstLoad = !initializedRef.current;
    if (firstLoad) {
      initializedRef.current = true;
      void loadCategories();
      void loadPosts(1);
      void loadFiles(1);
    }

    const normalizedQuery = searchQuery.trim();
    const visibleQueryRef = urlTab === "posts" ? postViewQueryRef : fileViewQueryRef;
    if (normalizedQuery) {
      if (visibleQueryRef.current !== normalizedQuery) void runSearch(normalizedQuery, urlTab);
    } else if (!firstLoad) {
      restoreDefaultView("posts");
      restoreDefaultView("files");
    }
    // Requests carry sequence IDs so stale responses cannot overwrite the latest URL state.
    // Request helpers intentionally read the latest pagination and cache refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, urlTab, user]);

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
    if (tab === "posts") postViewQueryRef.current = query;
    else fileViewQueryRef.current = query;
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

  async function refreshPosts(pageToLoad = postPage) {
    const query = searchQuery.trim();
    if (query) await runSearch(query, "posts");
    else await loadPosts(pageToLoad);
  }

  async function refreshFiles(pageToLoad = filePage) {
    const query = searchQuery.trim();
    if (query) await runSearch(query, "files");
    else await loadFiles(pageToLoad);
  }

  function handleSearch(query: string) {
    const normalized = query.trim();
    if (activeTab === urlTab && normalized === searchQuery.trim()) {
      if (normalized) void runSearch(normalized, activeTab);
      else if (activeTab === "posts") void loadPosts(1);
      else void loadFiles(1);
      return;
    }
    if (!normalized && searchQuery.trim()) restoreDefaultView(activeTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", activeTab);
    if (normalized) params.set("q", normalized);
    else params.delete("q");
    router.push(`/editor?${params.toString()}`);
  }

  function handleTabChange(tab: EditorTab) {
    if (tab === activeTab && !searchQuery.trim()) return;
    if (searchQuery.trim()) restoreDefaultView(activeTab);
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    params.delete("q");
    router.push(`/editor?${params.toString()}`);
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
      router.refresh();
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
          activeTab={activeTab}
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
          onLoadPosts={(page) => void loadPosts(page)}
          onLoadFiles={(page) => void loadFiles(page)}
          onRetryPosts={() => searchQuery.trim() ? void runSearch(searchQuery.trim(), "posts") : void loadPosts(postPage)}
          onRetryFiles={() => searchQuery.trim() ? void runSearch(searchQuery.trim(), "files") : void loadFiles(filePage)}
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
