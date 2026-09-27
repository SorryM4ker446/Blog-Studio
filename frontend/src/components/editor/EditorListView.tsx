"use client";

import { formatDate } from "@/lib/display-date";
import { submitSearchFromTop } from "@/lib/navigation-entry";
import { useMemo, useState } from "react";
import { useScopeTransition } from "@/lib/use-scope-transition";
import type { ResourceQuery } from "@/lib/resource-query";

import { getDownloadUrl, type Category, type FileRecord, type PostSummary } from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import PaginatedResults from "@/components/PaginatedResults";
import { formatFileSize, getFileLabel } from "@/components/files/FileCard";
import { getFileTypeLabel } from "@/lib/file-type";
import { InboxIcon, PlusIcon, UploadIcon } from "@/components/Icons";
import { EmptyState, ErrorState } from "@/components/ui/AsyncState";
import EditorSelect from "@/components/editor/EditorSelect";
import EditorRowActions from "./EditorRowActions";
import EditorPageLayout from "./EditorPageLayout";
import styles from "./EditorListView.module.css";
import highlightStyles from "./EditorRowHighlight.module.css";

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

function PostRow({ post, onView, onEdit, onDelete, opening, actionsOpen, onToggleActions, onCloseActions }: {
  post: PostSummary; onView: () => void; onEdit: () => void; onDelete: () => void; opening: boolean;
  actionsOpen: boolean; onToggleActions: () => void; onCloseActions: () => void;
}) {
  return (
    <article className={`${styles.row} ${highlightStyles.row} ${actionsOpen ? highlightStyles.active : ""} editor-post-card`} data-editor-row-id={post.id}>
      <button type="button" className={styles.main} onClick={onView} aria-label={`Open ${post.title}`}>
        <span className={styles.title}>{post.title}</span>
        <span className={styles.description}>{post.summary || "No introduction provided."}</span>
      </button>
      <div className={styles.meta}>
        <span className={post.status === "published" ? "editor-post-status editor-post-published" : "editor-post-status editor-post-draft"}>
          {post.status === "published" ? "Published" : "Draft"}
        </span>
        <span className={post.category_id == null ? "editor-post-category editor-post-category-empty" : "editor-post-category"}>
          {post.category_id == null ? "无标签" : post.category?.name || "Uncategorized"}
        </span>
        <time className={styles.date} dateTime={post.updated_at}>{formatDate(post.updated_at)}</time>
      </div>
      <EditorRowActions label={post.title} open={actionsOpen} opening={opening} onToggle={onToggleActions} onClose={onCloseActions} onEdit={onEdit} onDelete={onDelete} />
    </article>
  );
}

function FileRow({ file, onPreview, onEdit, onDelete, actionsOpen, onToggleActions, onCloseActions }: {
  file: FileRecord; onPreview: () => void; onEdit: () => void; onDelete: () => void;
  actionsOpen: boolean; onToggleActions: () => void; onCloseActions: () => void;
}) {
  const label = getFileLabel(file);
  const description = file.description.trim() || "No description provided.";
  return <article className={`${styles.row} ${highlightStyles.row} ${actionsOpen ? highlightStyles.active : ""}`} data-file-id={file.id} data-editor-row-id={file.id}>
    <button type="button" className={styles.main} onClick={onPreview} aria-label={`Preview ${label}`}>
      <span className={styles.title}>{label}</span>
      <span className={styles.description}>{description}</span>
    </button>
    <div className={styles.meta}>
      <span className={styles.fileMeta}>{formatFileSize(file.size)}</span>
      <span className={styles.fileMeta} title={file.mime_type}>{getFileTypeLabel(file.orig_name, file.mime_type)}</span>
      <time className={styles.date} dateTime={file.created_at}>{formatDate(file.created_at)}</time>
    </div>
    <EditorRowActions label={label} open={actionsOpen} onToggle={onToggleActions} onClose={onCloseActions}
      onEdit={onEdit} onDelete={onDelete} downloadUrl={getDownloadUrl(file.id)} />
  </article>;
}

export default function EditorListView(controls: EditorListViewProps) {
  const [animatePages, setAnimatePages] = useState(false);
  const [animateCriteria, setAnimateCriteria] = useState(false);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const requestedLoading = controls.activeTab === "links" ? controls.links.loading : controls.activeTab === "posts" ? controls.postsLoading : controls.filesLoading;
  const resultQuery = controls.activeTab === "posts" ? controls.postResultQuery : controls.fileResultQuery;
  const value = useMemo(() => ({ ...controls, scope: controls.activeTab,
    query: controls.activeTab === "links" ? controls.links.query : resultQuery?.query ?? controls.searchQuery,
    categoryId: controls.activeTab === "links" ? "" : resultQuery?.categoryId ?? controls.categoryId,
    error: controls.activeTab === "links" ? controls.links.error : controls.activeTab === "posts" ? controls.postsError : controls.filesError,
  }), [controls, resultQuery]);
  const { displayed: props, ref, changing } = useScopeTransition(value, controls.activeTab, requestedLoading,
    { query: controls.activeTab === "links" ? controls.links.query : controls.searchQuery, categoryId: controls.activeTab === "posts" ? controls.categoryId : "" }, animateCriteria && !controls.restoring);
  function changeTab(tab: EditorTab) { setOpenActions(null); setAnimateCriteria(true); controls.onTabChange(tab); }
  function submitSearch(query: string) {
    setOpenActions(null);
    setAnimateCriteria(true);
    submitSearchFromTop(() => {
      if (controls.activeTab === "links") controls.links.search(query);
      else controls.onSearch(query);
    });
  }
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
            onChange={category => { setOpenActions(null); setAnimateCriteria(true); controls.onCategoryChange(category); }}
          />}
          <SearchInput variant="editor" placeholder={`Search ${controls.activeTab}...`} onSearch={submitSearch} value={controls.activeTab === "links" ? controls.links.query : controls.searchQuery} />
          {controls.activeTab === "links" ? controls.links.toolbar : <button type="button" onClick={controls.activeTab === "posts" ? controls.onNewPost : controls.onUploadFile} className="editor-primary-action">
            {controls.activeTab === "posts" ? <><PlusIcon size={16} /> New Post</> : <><UploadIcon size={16} /> Upload</>}
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
              allowOverflow
              animateChanges={animatePages && !props.restoring}
              key={props.activeTab}
              transitionGroup={JSON.stringify([props.activeTab, props.query, props.categoryId])}
              page={page}
              totalPages={pages}
              resultKey={String(page)}
              pending={loading}
              onPageChange={(page) => {
                setOpenActions(null);
                setAnimatePages(true);
                (props.activeTab === "posts" ? props.onLoadPosts : props.onLoadFiles)(page);
              }}
            >
              {error ? <ErrorState title={`Editor ${props.activeTab} could not be loaded`} message={error} onRetry={retry} retrying={loading} /> : loading && !hasItems ? <p role="status" style={{ padding: "1.5rem", color: "var(--text-muted)" }}>Loading {props.activeTab}…</p> : <div className={styles.list} data-editor-list data-resource={props.activeTab}>
                <div className={styles.header} data-editor-list-header aria-hidden="true">
                  <span>{props.activeTab === "posts" ? "Title & Introduction" : "File & Description"}</span>
                  <span>{props.activeTab === "posts" ? "Status" : "Size"}</span>
                  <span>{props.activeTab === "posts" ? "Category" : "Type"}</span>
                  <span>{props.activeTab === "posts" ? "Updated At" : "Uploaded At"}</span>
                  <span>Actions</span>
                </div>
                {props.activeTab === "posts"
                  ? props.posts.map((post) => (
                      <PostRow
                        key={post.id}
                        post={post}
                        opening={controls.openingPostId === post.id && !controls.openingError}
                        actionsOpen={openActions === `post:${post.id}`}
                        onToggleActions={() => setOpenActions(current => current === `post:${post.id}` ? null : `post:${post.id}`)}
                        onCloseActions={() => setOpenActions(null)}
                        onView={() => props.onViewPost(post)}
                        onEdit={() => props.onEditPost(post)}
                        onDelete={() => props.onDeletePost(post.id)}
                      />
                    ))
                  : props.files.map((file) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        actionsOpen={openActions === `file:${file.id}`}
                        onToggleActions={() => setOpenActions(current => current === `file:${file.id}` ? null : `file:${file.id}`)}
                        onCloseActions={() => setOpenActions(null)}
                        onPreview={() => props.onPreviewFile(file)}
                        onEdit={() => props.onEditFile(file)}
                        onDelete={() => props.onDeleteFile(file.id)}
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
