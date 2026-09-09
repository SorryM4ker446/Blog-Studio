import { normalizeMarkdownFileUrls, type PostDetail } from "./api";

export type PostAction = "save" | "publish" | "unpublish";
export interface PostSnapshot { title: string; summary: string; content: string; category_id: number }

export function postSnapshot(post: PostDetail | null): PostSnapshot {
  return post ? { title: post.title, summary: post.summary, content: normalizeMarkdownFileUrls(post.content), category_id: post.category_id ?? 0 }
    : { title: "", summary: "", content: "", category_id: 0 };
}

export function isPostDirty(current: PostSnapshot, saved: PostSnapshot): boolean {
  return current.title !== saved.title || current.summary !== saved.summary
    || current.content !== saved.content || current.category_id !== saved.category_id;
}
