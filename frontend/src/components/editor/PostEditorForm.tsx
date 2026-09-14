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
import type { PostAction } from "@/lib/post-editor";
import "react-markdown-editor-lite/lib/index.css";

const MdEditor = dynamic(() => import("./MarkdownEditor"));

const mdParser = createMarkdownParser();

interface PostEditorFormProps {
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
    <form onSubmit={handleSubmit} aria-busy={props.saving}>
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
        <span>{props.saving ? "Saving changes…" : props.recoveryChecking ? "Checking browser recovery…" : props.dirty ? "Unsaved changes" : props.editingPost ? "All changes saved" : "New draft"}</span>
        {props.editingPost?.status === "published" && <Link className="editor-view-link" href={`/posts/${props.editingPost.id}?returnTo=${encodeURIComponent(returnTo)}`} aria-disabled={props.saving}
          aria-label="View article" title="View article"
          onNavigate={(event) => { if (props.saving) event.preventDefault(); else props.onViewArticle(); }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </Link>}
      </div>
      {props.sessionExpired && <p role="alert">Your edits are still here. <a href="/login?redirect=%2Feditor" target="_blank" rel="noopener noreferrer">Sign in in a new tab</a>, then return here and try again.</p>}
      {props.conflict && <section className="editor-conflict" aria-label="Article version conflict">
        <h2>This article changed elsewhere</h2>
        <p>Your edits have been kept. Copy any text you want to keep before replacing this form with the latest saved version.</p>
        <button type="button" onClick={props.onLoadLatest} disabled={props.loadingLatest}>{props.loadingLatest ? "Loading…" : "Load latest version"}</button>
        {props.latestError && <p role="alert">{props.latestError}</p>}
        {props.latestPost && <>
          <p>Latest: {props.latestPost.title} · {formatDateTime(props.latestPost.updated_at)}</p>
          <label>Latest saved content<textarea readOnly value={props.latestPost.content} /></label>
          <button type="button" onClick={props.onUseLatest} disabled={props.loadingLatest}>Discard my edits and use latest</button>
        </>}
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
            aria-describedby={failed ? "post-save-message" : undefined}
            className="editor-title-input"
            placeholder="Enter post title…"
          />
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label htmlFor="post-summary" style={labelStyle}>INTRODUCTION</label>
          <textarea
            id="post-summary"
            value={props.summary}
            onChange={(event) => props.onSummaryChange(event.target.value)}
            maxLength={1000}
            className="editor-summary-input"
            placeholder="Write a brief introduction for this post…"
          />
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
              role="group"
              aria-label="Markdown editor"
              aria-describedby={failed ? "post-save-message" : undefined}
            >
              <MdEditor
                id="post-markdown"
                value={props.content}
                readOnly={props.saving}
                style={{ height: "calc(100dvh - 450px)", minHeight: "450px", borderRadius: "12px", border: "1px solid var(--border-color)" }}
                renderHTML={(text: string) => mdParser.render(normalizeMarkdownFileUrls(text))}
                onChange={({ text }: { text: string }) => { if (!props.saving) props.onContentChange(text); }}
                onImageUpload={props.onImageUpload}
                onPaste={handlePaste}
              />
            </div>
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
