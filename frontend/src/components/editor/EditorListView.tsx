"use client";

import type { FileRecord, Post } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import FileCard, { EditActionButton } from "@/components/files/FileCard";
import { EditIcon, FileTextIcon, FolderIcon, InboxIcon, UploadIcon } from "@/components/Icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AsyncState";

export type EditorTab = "posts" | "files";

interface EditorListViewProps {
  activeTab: EditorTab;
  searchQuery: string;
  posts: Post[];
  files: FileRecord[];
  postCount: number | null;
  fileCount: number | null;
  postsLoading: boolean;
  filesLoading: boolean;
  postsError: string;
  filesError: string;
  postPage: number;
  postTotalPages: number;
  filePage: number;
  fileTotalPages: number;
  onTabChange: (tab: EditorTab) => void;
  onSearch: (query: string) => void;
  onNewPost: () => void;
  onUploadFile: () => void;
  onViewPost: (post: Post) => void;
  onEditPost: (post: Post) => void;
  onDeletePost: (id: number) => void;
  onPreviewFile: (file: FileRecord) => void;
  onEditFile: (file: FileRecord) => void;
  onDeleteFile: (id: number) => void;
  onLoadPosts: (page: number) => void;
  onLoadFiles: (page: number) => void;
  onRetryPosts: () => void;
  onRetryFiles: () => void;
}

function PostCard({ post, onView, onEdit, onDelete }: { post: Post; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="ai-card editor-post-card" onClick={onView}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onView();
        }}
        className="editor-post-card-open"
        aria-label={`Open ${post.title}`}
      />
      <div className="editor-post-card-header">
        <div className="editor-post-card-content">
          <span style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
            <span className="editor-post-title">{post.title}</span>
            <span className={post.status === "published" ? "editor-post-status editor-post-published" : "editor-post-status editor-post-draft"}>
              {post.status === "published" ? "Published" : "Draft"}
            </span>
          </span>
          <span className="editor-post-summary">
            {post.summary || <span style={{ opacity: 0.5 }}>No introduction provided.</span>}
          </span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="editor-post-delete"
          aria-label={`Delete ${post.title}`}
          title="Delete post"
        >
          ×
        </button>
      </div>
      <div className="editor-post-card-footer">
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span>{new Date(post.updated_at).toLocaleDateString()}</span>
          <span className={post.category_id == null ? "editor-post-category editor-post-category-empty" : "editor-post-category"}>
            {post.category_id == null ? "无标签" : post.category?.name || "Uncategorized"}
          </span>
        </div>
        <span className="editor-post-card-actions" onClick={(event) => event.stopPropagation()}>
          <EditActionButton onClick={onEdit} />
        </span>
      </div>
    </article>
  );
}

export default function EditorListView(props: EditorListViewProps) {
  const loading = props.activeTab === "posts" ? props.postsLoading : props.filesLoading;
  const error = props.activeTab === "posts" ? props.postsError : props.filesError;
  const hasItems = props.activeTab === "posts" ? props.posts.length > 0 : props.files.length > 0;
  const retry = props.activeTab === "posts" ? props.onRetryPosts : props.onRetryFiles;

  return (
    <div className="fade-in">
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.5rem" }}>
          <EditIcon size={28} /> Content Editor
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Manage and edit your posts and cloud drive files.</p>
      </header>

      <div className="editor-list-toolbar">
        <div role="tablist" aria-label="Editor resources" className="editor-tabs">
          <button
            type="button"
            role="tab"
            id="editor-posts-tab"
            aria-controls="editor-resource-panel"
            aria-selected={props.activeTab === "posts"}
            className={props.activeTab === "posts" ? "editor-tab editor-tab-active" : "editor-tab"}
            onClick={() => props.onTabChange("posts")}
          >
            <FileTextIcon size={18} /> Posts{props.postCount === null ? "" : ` (${props.postCount})`}
          </button>
          <button
            type="button"
            role="tab"
            id="editor-files-tab"
            aria-controls="editor-resource-panel"
            aria-selected={props.activeTab === "files"}
            className={props.activeTab === "files" ? "editor-tab editor-tab-active" : "editor-tab"}
            onClick={() => props.onTabChange("files")}
          >
            <FolderIcon size={18} /> Files{props.fileCount === null ? "" : ` (${props.fileCount})`}
          </button>
        </div>

        <div className="editor-list-actions">
          <SearchInput placeholder={`Search ${props.activeTab}...`} onSearch={props.onSearch} style={{ width: "220px" }} value={props.searchQuery} />
          <button type="button" onClick={props.activeTab === "posts" ? props.onNewPost : props.onUploadFile} className="editor-primary-action">
            {props.activeTab === "posts" ? "+ New Post" : <><UploadIcon size={16} /> Upload File</>}
          </button>
        </div>
      </div>

      <section
        id="editor-resource-panel"
        role="tabpanel"
        aria-labelledby={`editor-${props.activeTab}-tab`}
        aria-busy={loading}
        className="editor-resource-panel"
      >
        {loading && hasItems && <span className="sr-only" role="status">Refreshing {props.activeTab}…</span>}

        {loading && !hasItems ? (
          <LoadingState label={`Loading ${props.activeTab}…`} rows={3} />
        ) : error ? (
          <ErrorState
            title={`Editor ${props.activeTab} could not be loaded`}
            message={error}
            onRetry={retry}
            retrying={loading}
          />
        ) : !hasItems ? (
          <EmptyState
            title={props.searchQuery ? `No matching ${props.activeTab}` : `No ${props.activeTab} yet`}
            message={props.searchQuery ? "Try a different search term." : props.activeTab === "posts" ? "Create a post to get started." : "Upload a file to get started."}
            icon={<InboxIcon size={54} />}
          />
        ) : (
          <div className="editor-resource-grid">
            {props.activeTab === "posts"
              ? props.posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onView={() => props.onViewPost(post)}
                    onEdit={() => props.onEditPost(post)}
                    onDelete={() => props.onDeletePost(post.id)}
                  />
                ))
              : props.files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onPreview={props.onPreviewFile}
                    onEdit={props.onEditFile}
                    onDelete={(item) => props.onDeleteFile(item.id)}
                  />
                ))}
          </div>
        )}

        {!error && props.activeTab === "posts" && props.posts.length > 0 && (
          <Pagination currentPage={props.postPage} totalPages={props.postTotalPages} onPageChange={props.onLoadPosts} />
        )}
        {!error && props.activeTab === "files" && props.files.length > 0 && (
          <Pagination currentPage={props.filePage} totalPages={props.fileTotalPages} onPageChange={props.onLoadFiles} />
        )}
      </section>
    </div>
  );
}
