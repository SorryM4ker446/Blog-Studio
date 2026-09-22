"use client";

import { formatDate } from "@/lib/display-date";
import { useMemo, useState } from "react";
import { useScopeTransition } from "@/lib/use-scope-transition";
import type { ResourceQuery } from "@/lib/resource-query";

import type { Category, FileRecord, PostSummary } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import PaginatedResults from "@/components/PaginatedResults";
import FileCard, { EditActionButton } from "@/components/files/FileCard";
import { InboxIcon, UploadIcon } from "@/components/Icons";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";
import EditorSelect from "@/components/editor/EditorSelect";
import EditorPageLayout from "./EditorPageLayout";

import type useLinksManager from "@/components/links/LinksManager";
import EditorResourceTabs, { EditorHeading, type EditorTab } from "./EditorResourceTabs";
export type { EditorTab } from "./EditorResourceTabs";

interface EditorListViewProps {
  openingPostId?: number | null;
  openingError?: string;
  onRetryOpen?: () => void;
  onCancelOpen?: () => void;
  activeTab: EditorTab;
  links: ReturnType<typeof useLinksManager>;
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
  const requestedLoading = controls.activeTab === "links" ? controls.links.loading : controls.activeTab === "posts" ? controls.postsLoading : controls.filesLoading;
  const resultQuery = controls.activeTab === "posts" ? controls.postResultQuery : controls.fileResultQuery;
  const value = useMemo(() => ({ ...controls, scope: controls.activeTab,
    query: controls.activeTab === "links" ? controls.links.query : resultQuery?.query ?? controls.searchQuery,
    categoryId: controls.activeTab === "links" ? "" : resultQuery?.categoryId ?? controls.categoryId,
    error: controls.activeTab === "links" ? controls.links.error : controls.activeTab === "posts" ? controls.postsError : controls.filesError,
  }), [controls, resultQuery]);
  const { displayed: props, ref, changing } = useScopeTransition(value, controls.activeTab, requestedLoading,
    { query: controls.activeTab === "links" ? controls.links.query : controls.searchQuery, categoryId: controls.activeTab === "posts" ? controls.categoryId : "" }, animateCriteria && !controls.restoring);
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
      <EditorHeading />
      <div className="editor-list-toolbar">
        <EditorResourceTabs activeTab={controls.activeTab} onChange={changeTab} counts={{ posts: controls.postCount, files: controls.fileCount, links: controls.links.count }} />

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
          <SearchInput variant="editor" placeholder={`Search ${controls.activeTab}...`} onSearch={query => { setAnimateCriteria(true); if (controls.activeTab === "links") controls.links.search(query); else controls.onSearch(query); }} style={{ width: "220px" }} value={controls.activeTab === "links" ? controls.links.query : controls.searchQuery} />
          {controls.activeTab === "links" ? controls.links.toolbar : <button type="button" onClick={controls.activeTab === "posts" ? controls.onNewPost : controls.onUploadFile} className="editor-primary-action">
            {controls.activeTab === "posts" ? "+ New Post" : <><UploadIcon size={16} /> Upload File</>}
          </button>}
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
        {props.activeTab !== "links" && loading && hasItems && <span className="sr-only" role="status">Refreshing {props.activeTab}…</span>}

        {props.activeTab === "links" ? props.links.content : !error && !props.restoring && !hasItems ? (
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
