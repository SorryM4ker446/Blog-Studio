"use client";

import { formatDateTime } from "@/lib/display-date";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ClipboardEvent, FormEvent } from "react";
import type { Category, PostDetail } from "@/lib/api";
import { normalizeMarkdownFileUrls } from "@/lib/api";
import { createMarkdownParser } from "@/lib/markdown";
import CategoryField from "@/components/editor/CategoryField";
import { validatePostFields, type PostAction } from "@/lib/post-editor";
import "react-markdown-editor-lite/lib/index.css";

import type MarkdownEditor from "./MarkdownEditor";
import feedback from "./EditorFeedback.module.css";

const LazyMdEditor = dynamic(() => import("./MarkdownEditor"));

const mdParser = createMarkdownParser();

interface PostEditorFormProps {
  MarkdownComponent?: typeof MarkdownEditor;
  validationAttempted?: boolean;
  editingPost: PostDetail | null;
  title: string;
  summary: string;
  content: string;
  categoryId: number;
  dirty: boolean;
  action: PostAction;
  conflict: boolean;
  recoveryPending?: boolean;
  recoveryChecking?: boolean;
  latestPost: PostDetail | null;
  loadingLatest: boolean;
  latestError: string;
  sessionExpired: boolean;
  onLoadLatest: () => void;
  onUseLatest: () => void;
  onKeepEdits: () => void;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
  onViewArticle: () => void;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string;
  saving: boolean;
  saveMessage: string;
  onTitleChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onCategoryChange: (value: number) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onCreateCategory: (name: string) => Promise<string | null>;
  onRenameCategory: (id: number, name: string) => Promise<string | null>;
  onDeleteCategory: (id: number) => void;
  onRetryCategories: () => void;
  onImageUpload: (file: File) => Promise<string>;
}

const labelStyle = {
  display: "block",
  fontSize: "0.8rem",
  color: "var(--text-muted)",
  marginBottom: "0.8rem",
  fontWeight: 600,
  letterSpacing: "0.05em",
} as const;

export default function PostEditorForm(props: PostEditorFormProps) {
  const MdEditor = props.MarkdownComponent ?? LazyMdEditor;
  const errors = props.validationAttempted ? validatePostFields(props) : { title: "", summary: "", content: "" };
  const failed = props.saveMessage.startsWith("❌");
  const params = useSearchParams();
  const returnTo = `/editor?${params.toString()}`;

  function handlePaste(event: ClipboardEvent) {
    const hasImage = Array.from(event.clipboardData.items).some((item) => item.type.startsWith("image/"));
    if (hasImage) event.preventDefault();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void props.onSave();
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={props.saving}>
      <div className="editor-form-header">
        <button type="button" disabled={props.saving} onClick={props.onBack} className="editor-back-button" aria-label="Back to content list">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: "1.5rem" }}>
            {props.editingPost ? `Editing: ${props.editingPost.title}` : "New Post"}
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "4px 0 0" }}>
            {props.editingPost ? `Last updated: ${formatDateTime(props.editingPost.updated_at)}` : "Not saved yet"}
          </p>
        </div>
        <div className="editor-header-actions">
          <span className="editor-publication-status" data-published={props.editingPost?.status === "published"}>{props.editingPost?.status === "published" ? "Published" : "Draft"}</span>
          <button type="button" className="editor-publication-action" disabled={props.saving || props.conflict || props.recoveryPending}
            onClick={() => void (props.editingPost?.status === "published" ? props.onUnpublish() : props.onPublish())}>
            {props.saving && props.action === "publish" ? "Publishing…" : (props.editingPost?.status === "published" ? "Draft" : "Publish")}
          </button>
          <button type="submit" disabled={props.saving || props.conflict || props.recoveryPending} className="editor-save-button">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" />
              <path d="M7 3v6h10V3M7 21v-8h10v8" />
            </svg>
            <span>Save</span>
          </button>
        </div>
      </div>

      <div className="editor-save-state" role="status">
        <span>{props.saving ? "Saving changes…" : props.recoveryChecking ? "Checking browser recovery…" : props.recoveryPending ? "Choose a recovery option above" : props.dirty ? "Unsaved changes" : props.editingPost ? "All changes saved" : "New draft"}</span>
        {props.editingPost?.status === "published" && <Link className="editor-view-link" href={`/posts/${props.editingPost.id}?returnTo=${encodeURIComponent(returnTo)}`} aria-disabled={props.saving}
          aria-label="View article" title="View article"
          onNavigate={(event) => { if (props.saving) event.preventDefault(); else props.onViewArticle(); }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </Link>}
      </div>
      {props.sessionExpired && <p role="alert">Your edits are still here. <a href="/login?redirect=%2Feditor" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a>, then return here and try again.</p>}
      {props.conflict && <section className={`${feedback.panel} ${feedback.conflictPanel}`} aria-label="Article version conflict" aria-busy={props.loadingLatest}>
        <div className={feedback.panelHeader}>
          <span className={feedback.icon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10a9 9 0 1 1 2.7 8.4M3 4v6h6M12 7v5l3 2" />
            </svg>
          </span>
          <div className={feedback.conflictHeading}><p className={feedback.eyebrow}>VERSION REVIEW</p><h2 className={feedback.title}>This article changed elsewhere</h2></div>
        </div>
        <p className={feedback.description}>Your edits are still editable below. Review the saved version, then choose which content to continue with. Keeping your edits does not merge changes from the server.</p>
        <div className={feedback.conflictToolbar}>
          <span className={feedback.timestamp}>Saving and publishing are paused until this conflict is resolved.</span>
          <button type="button" className={`${feedback.button} ${feedback.secondary}`} onClick={props.onLoadLatest} disabled={props.loadingLatest}>{props.loadingLatest ? "Loading…" : (props.latestPost ? "Refresh saved version" : "Review saved version")}</button>
        </div>
        {props.latestError && <p className={feedback.error} role="alert">{props.latestError}</p>}
        {props.latestPost && <div className={feedback.conflictPreview}>
          <div className={feedback.conflictMetadata}>
            <div className={feedback.copyDetails}><p className={feedback.eyebrow}>LATEST SAVED VERSION</p><p className={feedback.copyTitle}>{props.latestPost.title}</p></div>
            <time className={feedback.timestamp} dateTime={props.latestPost.updated_at}>{formatDateTime(props.latestPost.updated_at)}</time>
          </div>
          <label className={feedback.conflictLabel}>Latest saved content<textarea className={feedback.conflictContent} readOnly value={props.latestPost.content} spellCheck={false} /></label>
          <div className={feedback.conflictFooter}>
            <p className={feedback.hint}>Keeping your edits lets your next save replace the reviewed server content. Using the saved version discards your current edits. Neither choice saves or publishes.</p>
            <div className={feedback.recoveryActions}>
            <button type="button" className={`${feedback.button} ${feedback.primary}`} onClick={props.onKeepEdits} disabled={props.loadingLatest}>Keep my edits and continue</button>
            <button type="button" className={`${feedback.button} ${feedback.replaceAction}`} onClick={props.onUseLatest} disabled={props.loadingLatest}>Discard my edits and use latest</button>
            </div>
          </div>
        </div>}
      </section>}
      <fieldset className="editor-form-surface" disabled={props.saving || props.recoveryPending} inert={props.saving || props.recoveryPending}>
        <div style={{ marginBottom: "2rem" }}>
          <label htmlFor="post-title" style={labelStyle}>POST TITLE</label>
          <input
            id="post-title"
            value={props.title}
            onChange={(event) => props.onTitleChange(event.target.value)}
            required
            maxLength={255}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "post-title-error" : undefined}
            className="editor-title-input"
            placeholder="Enter post title…"
          />
          <FieldError id="post-title-error" message={errors.title} />
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label htmlFor="post-summary" style={labelStyle}>INTRODUCTION</label>
          <textarea
            id="post-summary"
            aria-invalid={Boolean(errors.summary)}
            aria-describedby={errors.summary ? "post-summary-error" : undefined}
            value={props.summary}
            onChange={(event) => props.onSummaryChange(event.target.value)}
            maxLength={1000}
            className="editor-summary-input"
            placeholder="Write a brief introduction for this post…"
          />
          <FieldError id="post-summary-error" message={errors.summary} />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: "0 0 2rem" }}>
          <legend style={labelStyle}>CATEGORY / TAG</legend>
          {props.categoriesLoading && (
            <p role="status" aria-live="polite" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              Loading categories…
            </p>
          )}
          {props.categoriesError && (
            <div role="alert" className="editor-category-error">
              <span>{props.categoriesError}</span>
              <button type="button" onClick={props.onRetryCategories}>Try again</button>
            </div>
          )}
          <CategoryField
            categories={props.categories}
            value={props.categoryId}
            loading={props.categoriesLoading}
            onChange={props.onCategoryChange}
            onCreate={props.onCreateCategory}
            onRename={props.onRenameCategory}
            onDelete={props.onDeleteCategory}
          />
        </fieldset>

        <div>
          <label htmlFor="post-markdown_md" id="post-content-label" style={labelStyle}>CONTENT (MARKDOWN) · REQUIRED</label>
            <div
              className="custom-editor-wrapper"
              data-invalid={Boolean(errors.content)}
              role="group"
              aria-label="Markdown editor"
              aria-describedby={errors.content ? "post-content-error" : undefined}
            >
              <MdEditor
                id="post-markdown"
                invalid={Boolean(errors.content)}
                errorId={errors.content ? "post-content-error" : undefined}
                value={props.content}
                readOnly={props.saving}
                style={{ height: "calc(100dvh - 450px)", minHeight: "450px", borderRadius: "12px", border: "1px solid var(--border-color)" }}
                renderHTML={(text: string) => mdParser.render(normalizeMarkdownFileUrls(text))}
                onChange={({ text }: { text: string }) => { if (!props.saving) props.onContentChange(text); }}
                onImageUpload={props.onImageUpload}
                onPaste={handlePaste}
              />
            </div>
          <FieldError id="post-content-error" message={errors.content} />
        </div>

      </fieldset>
      <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
        {props.saveMessage && (
          <div
            id="post-save-message"
            role={failed ? "alert" : "status"}
            aria-live={failed ? "assertive" : "polite"}
            className={failed ? "editor-save-message editor-save-message-error" : "editor-save-message"}
          >
            {props.saveMessage}
          </div>
        )}
      </div>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return message ? <p id={id} className="editor-field-error" role="alert">
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" />
    </svg>
    <span>{message}</span>
  </p> : null;
}
