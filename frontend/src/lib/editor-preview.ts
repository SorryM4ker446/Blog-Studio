import type { PostDetail } from "./api";
import type { PostSnapshot } from "./post-editor";

interface EditorPreview {
  userId: number;
  returnTo: string;
  post: PostDetail;
  fields: PostSnapshot;
  expiresAt: number;
}

// A single tab-local handoff for viewing an article; never persisted to browser storage.
let preview: EditorPreview | null = null;

export function rememberEditorPreview(userId: number, returnTo: string, post: PostDetail, fields: PostSnapshot) {
  preview = { userId, returnTo, post, fields: { ...fields }, expiresAt: Date.now() + 30 * 60_000 };
}

export function readEditorPreview(userId: number | undefined, target: number | "new" | null) {
  if (typeof window === "undefined" || !preview) return null;
  if (preview.expiresAt <= Date.now()) { preview = null; return null; }
  return preview.userId === userId && preview.post.id === target ? preview : null;
}

export function clearEditorPreview() { preview = null; }

export function editorReturnPath(value: string | null, articleId: string): string | null {
  if (!value?.startsWith("/editor?")) return null;
  const url = new URL(value, "https://editor.invalid");
  if (url.origin !== "https://editor.invalid" || url.pathname !== "/editor" || url.hash
    || url.searchParams.getAll("edit").length !== 1 || url.searchParams.get("edit") !== articleId
    || (url.searchParams.has("tab") && url.searchParams.get("tab") !== "posts")) return null;
  return `${url.pathname}${url.search}`;
}
