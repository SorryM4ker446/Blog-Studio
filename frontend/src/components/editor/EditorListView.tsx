"use client";

import { formatDate } from "@/lib/display-date";
import { useMemo, useState } from "react";
import { useScopeTransition } from "@/lib/use-scope-transition";
import type { ResourceQuery } from "@/lib/resource-query";

import type { Category, FileRecord, PostSummary } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import PaginatedResults from "@/components/PaginatedResults";
import FileCard, { EditActionButton } from "@/components/files/FileCard";
import { EditIcon, FileTextIcon, FolderIcon, InboxIcon, UploadIcon } from "@/components/Icons";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";
import EditorSelect from "@/components/editor/EditorSelect";
import EditorPageLayout from "./EditorPageLayout";

export type EditorTab = "posts" | "files";

interface EditorListViewProps {
  openingPostId?: number | null;
  openingError?: string;
  onRetryOpen?: () => void;
  onCancelOpen?: () => void;
  activeTab: EditorTab;
  searchQuery: string;
  postResultQuery?: ResourceQuery;
  fileResultQuery?: ResourceQuery;
  categories: Category[];
  categoryId: string;
  onCategoryChange: (categoryId: string) => void;
  posts: PostSummary[];
  files: FileRecord[];
  postCount: number | null;
  fileCount: number | null;
  postsLoading: boolean;
  filesLoading: boolean;
  restoring?: boolean;
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
  onViewPost: (post: PostSummary) => void;
  onEditPost: (post: PostSummary) => void;
  onDeletePost: (id: number) => void;
  onPreviewFile: (file: FileRecord) => void;
  onEditFile: (file: FileRecord) => void;
  onDeleteFile: (id: number) => void;
  onLoadPosts: (page: number) => void;
  onLoadFiles: (page: number) => void;
  onRetryPosts: () => void;
  onRetryFiles: () => void;
}

function PostCard({ post, onView, onEdit, onDelete, opening }: { opening?: boolean; post: PostSummary; onView: () => void; onEdit: () => void; onDelete: () => void }) {
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
            {post.summary || <span>No introduction provided.</span>}
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
          <span>{formatDate(post.updated_at)}</span>
          <span className={post.category_id == null ? "editor-post-category editor-post-category-empty" : "editor-post-category"}>
            {post.category_id == null ? "无标签" : post.category?.name || "Uncategorized"}
          </span>
        </div>
        <span className="editor-post-card-actions" onClick={(event) => event.stopPropagation()}>
          <EditActionButton onClick={onEdit} busy={opening} />
        </span>
      </div>
    </article>
  );
}

export default function EditorListView(controls: EditorListViewProps) {
  const [animatePages, setAnimatePages] = useState(false);
  const [animateCriteria, setAnimateCriteria] = useState(false);
  const requestedLoading = controls.activeTab === "posts" ? controls.postsLoading : controls.filesLoading;
  const resultQuery = controls.activeTab === "posts" ? controls.postResultQuery : controls.fileResultQuery;
  const value = useMemo(() => ({ ...controls, scope: controls.activeTab,
    query: resultQuery?.query ?? controls.searchQuery,
    categoryId: resultQuery?.categoryId ?? controls.categoryId,
    error: controls.activeTab === "posts" ? controls.postsError : controls.filesError,
  }), [controls, resultQuery]);
  const { displayed: props, ref, changing } = useScopeTransition(value, controls.activeTab, requestedLoading,
    { query: controls.searchQuery, categoryId: controls.activeTab === "posts" ? controls.categoryId : "" }, animateCriteria && !controls.restoring);
  function changeTab(tab: EditorTab) { setAnimateCriteria(true); controls.onTabChange(tab); }
  const loading = props.activeTab === "posts" ? props.postsLoading : props.filesLoading;
  const error = props.activeTab === "posts" ? props.postsError : props.filesError;
  const hasItems = props.activeTab === "posts" ? props.posts.length > 0 : props.files.length > 0;
  const retry = props.activeTab === "posts" ? props.onRetryPosts : props.onRetryFiles;
  const page = props.activeTab === "posts" ? props.postPage : props.filePage;
  const pages = props.activeTab === "posts" ? props.postTotalPages : props.fileTotalPages;
  const count = props.activeTab === "posts" ? props.posts.length : props.files.length;

  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.5rem" }}>
          <EditIcon size={28} /> Content Editor
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Manage and edit your posts and cloud drive files.</p>
      </header>

      <div className="editor-list-toolbar">
        <div role="tablist" aria-label="Editor resources" className="editor-tabs" data-active-tab={controls.activeTab} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const tab = event.key === "Home" ? "posts" : event.key === "End" ? "files" : controls.activeTab === "posts" ? "files" : "posts";
          changeTab(tab);
          document.getElementById(`editor-${tab}-tab`)?.focus({ preventScroll: true });
        }}>
          <button
            type="button"
            role="tab"
            id="editor-posts-tab"
            tabIndex={controls.activeTab === "posts" ? 0 : -1}
            aria-controls="editor-resource-panel"
            aria-selected={controls.activeTab === "posts"}
            className={controls.activeTab === "posts" ? "editor-tab editor-tab-active" : "editor-tab"}
            onClick={() => changeTab("posts")}
          >
            <FileTextIcon size={18} /> Posts{controls.postCount === null ? "" : ` (${controls.postCount})`}
          </button>
          <button
            type="button"
            role="tab"
            id="editor-files-tab"
            tabIndex={controls.activeTab === "files" ? 0 : -1}
            aria-controls="editor-resource-panel"
            aria-selected={controls.activeTab === "files"}
            className={controls.activeTab === "files" ? "editor-tab editor-tab-active" : "editor-tab"}
            onClick={() => changeTab("files")}
          >
            <FolderIcon size={18} /> Files{controls.fileCount === null ? "" : ` (${controls.fileCount})`}
          </button>
        </div>

        <div className="editor-list-actions">
          {controls.activeTab === "posts" && <EditorSelect
            ariaLabel="Filter articles by category"
            unavailableLabel="Unavailable category"
            value={controls.categoryId}
            width="13rem"
            options={[
              { value: "", label: "All categories" },
              { value: "0", label: "Uncategorized" },
              ...controls.categories.map((category) => ({ value: String(category.id), label: category.name })),
            ]}
            onChange={category => { setAnimateCriteria(true); controls.onCategoryChange(category); }}
          />}
          <SearchInput placeholder={`Search ${controls.activeTab}...`} onSearch={query => { setAnimateCriteria(true); controls.onSearch(query); }} style={{ width: "220px" }} value={controls.searchQuery} />
          <button type="button" onClick={controls.activeTab === "posts" ? controls.onNewPost : controls.onUploadFile} className="editor-primary-action">
            {controls.activeTab === "posts" ? "+ New Post" : <><UploadIcon size={16} /> Upload File</>}
          </button>
        </div>
      </div>

      {controls.openingError && <div className="editor-open-error">
        <ErrorState title="Article could not be loaded" message={controls.openingError} onRetry={controls.onRetryOpen} />
        <button type="button" className="editor-publication-action" onClick={controls.onCancelOpen}>Cancel</button>
      </div>}
      <section
        id="editor-resource-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`editor-${props.activeTab}-tab`}
        aria-busy={requestedLoading || changing}
        className="editor-resource-panel"
        ref={ref}
        inert={changing}
      >
        {loading && hasItems && <span className="sr-only" role="status">Refreshing {props.activeTab}…</span>}

        {!error && !props.restoring && !hasItems ? (
          <EmptyState
            title={props.query ? `No matching ${props.activeTab}` : `No ${props.activeTab} yet`}
            message={props.query ? "Try a different search term." : props.activeTab === "posts" ? "Create a post to get started." : "Upload a file to get started."}
            icon={<InboxIcon size={54} />}
          />
        ) : (
          <EditorPageLayout resource={props.activeTab} count={(loading || error) && !hasItems ? 10 : count} pages={pages}>
            <PaginatedResults
              stablePageHeight
              animateChanges={animatePages && !props.restoring}
              key={props.activeTab}
              transitionGroup={JSON.stringify([props.activeTab, props.query, props.categoryId])}
              page={page}
              totalPages={pages}
              resultKey={String(page)}
              pending={loading}
              onPageChange={(page) => {
                setAnimatePages(true);
                (props.activeTab === "posts" ? props.onLoadPosts : props.onLoadFiles)(page);
              }}
            >
              {error ? <ErrorState title={`Editor ${props.activeTab} could not be loaded`} message={error} onRetry={retry} retrying={loading} /> : loading && !hasItems ? <p role="status" style={{ padding: "1.5rem", color: "var(--text-muted)" }}>Loading {props.activeTab}…</p> : <div className="editor-resource-grid">
                {props.activeTab === "posts"
                  ? props.posts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        opening={controls.openingPostId === post.id && !controls.openingError}
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
              </div>}
            </PaginatedResults>
          </EditorPageLayout>
        )}
      </section>
    </div>
  );
}
