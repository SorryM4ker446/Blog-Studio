"use client";

import dynamic from "next/dynamic";
import type { ClipboardEvent, FormEvent } from "react";
import type { Category, Post } from "@/lib/api";
import { normalizeMarkdownFileUrls } from "@/lib/api";
import CategoryField from "@/components/editor/CategoryField";
import EditorSelect from "@/components/editor/EditorSelect";
import "react-markdown-editor-lite/lib/index.css";

const MdEditor = dynamic(() => import("react-markdown-editor-lite"), { ssr: false });

let mdParser: { render: (text: string) => string } | null = null;
if (typeof window !== "undefined") {
  const MarkdownIt = require("markdown-it");
  const { imageSizePlugin } = require("@/lib/md-plugins");
  mdParser = new MarkdownIt({ html: false }).use(imageSizePlugin);
}

interface PostEditorFormProps {
  editingPost: Post | null;
  title: string;
  summary: string;
  content: string;
  categoryId: number;
  status: string;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string;
  saving: boolean;
  saveMessage: string;
  onTitleChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onCategoryChange: (value: number) => void;
  onStatusChange: (value: string) => void;
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

  function handlePaste(event: ClipboardEvent) {
    const hasImage = Array.from(event.clipboardData.items).some((item) => item.type.startsWith("image/"));
    if (hasImage) event.preventDefault();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void props.onSave();
  }

  return (
    <form className="fade-in" onSubmit={handleSubmit} aria-busy={props.saving}>
      <div className="editor-form-header">
        <button type="button" onClick={props.onBack} className="editor-back-button" aria-label="Back to content list">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: "1.5rem" }}>
            {props.editingPost ? `Editing: ${props.editingPost.title}` : "New Post"}
          </h1>
          {props.editingPost && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "4px 0 0" }}>
              Last updated: {new Date(props.editingPost.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
          <EditorSelect
            ariaLabel="Publication status"
            value={props.status}
            onChange={props.onStatusChange}
            width="140px"
            disabled={props.saving}
            options={[
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
            ]}
          />
          <button type="submit" disabled={props.saving} className="editor-save-button">
            {props.saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="editor-form-surface">
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
          <div id="post-content-label" style={labelStyle}>CONTENT (MARKDOWN) · REQUIRED</div>
          {mdParser && (
            <div
              className="custom-editor-wrapper"
              role="group"
              aria-labelledby="post-content-label"
              aria-describedby={failed ? "post-save-message" : undefined}
            >
              <MdEditor
                value={props.content}
                style={{ height: "calc(100vh - 450px)", minHeight: "450px", borderRadius: "12px", border: "1px solid var(--border-color)" }}
                renderHTML={(text: string) => mdParser!.render(normalizeMarkdownFileUrls(text))}
                onChange={({ text }: { text: string }) => props.onContentChange(text)}
                onImageUpload={props.onImageUpload}
                onPaste={handlePaste}
              />
            </div>
          )}
        </div>

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
      </div>
    </form>
  );
}
