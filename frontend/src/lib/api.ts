// lib/api.ts
import {
  API_BASE,
  ApiError,
  apiRequest,
  clearCSRFToken,
  ensureCSRFToken,
  isApiError,
  setCSRFToken,
} from "@/lib/api-client";
import { rebaseFileViewURLs } from "@/lib/file-url";

export { API_BASE, ApiError, getApiErrorMessage, isApiError } from "@/lib/api-client";
export type { ApiErrorKind } from "@/lib/api-client";

interface Category {
  id: number;
  name: string;
  description: string;
  post_count?: number;
  created_at: string;
}

interface Post {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  category_id: number | null;
  category: Category | null;
  status: string;
  published_at: string | null;
  last_edited_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FileRecord {
  id: number;
  orig_name: string;
  display_name: string;
  description: string;
  size: number;
  mime_type: string;
  is_system: boolean;
  created_at: string;
}

interface SearchResult {
  posts: Post[];
  files: FileRecord[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  error?: string;
}

export type { Category, Post, FileRecord, SearchResult, PaginatedResponse };

export interface FileMutationResult {
  ok: boolean;
  file?: FileRecord;
  error?: string;
  code?: string;
  status?: number | null;
  kind?: import("@/lib/api-client").ApiErrorKind;
  retryAfterSeconds?: number;
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

function fileMutationFailure(error: unknown, fallback: string): FileMutationResult {
  if (isApiError(error)) {
    return {
      ok: false,
      error: error.message || fallback,
      code: error.code,
      status: error.status,
      kind: error.kind,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return { ok: false, error: fallback };
}

export function getFileViewUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/view`;
}

export function normalizeFileViewUrl(url: string): string {
  return rebaseFileViewURLs(url, API_BASE);
}

export function normalizeMarkdownFileUrls(markdown: string): string {
  return rebaseFileViewURLs(markdown, API_BASE);
}

export function extractSearchablePostContent(markdown: string): string {
  if (!markdown) {
    return "";
  }
  // Remove markdown image blocks completely so file names/URLs don't affect post-text search.
  let content = markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, " ");
  // Keep link text and remove URL target.
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove bare URLs.
  content = content.replace(/https?:\/\/[^\s)]+/g, " ");
  return content;
}

export function filterPostsByVisibleText(posts: Post[], query: string): Post[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return posts;
  }
  return posts.filter((post) => {
    const title = (post.title || "").toLowerCase();
    const summary = (post.summary || "").toLowerCase();
    const categoryName = (post.category?.name || "").toLowerCase();
    const content = extractSearchablePostContent(post.content || "").toLowerCase();
    return (
      title.includes(q) ||
      summary.includes(q) ||
      categoryName.includes(q) ||
      content.includes(q)
    );
  });
}

export function getPostTimeline(post: Pick<Post, "published_at" | "last_edited_at" | "updated_at">): {
  label: "Published" | "Updated";
  timestamp: string;
} {
  if (post.last_edited_at) {
    return { label: "Updated", timestamp: post.last_edited_at };
  }
  return {
    label: "Published",
    timestamp: post.published_at || post.updated_at,
  };
}

function getMutationHeaders(isFormData = false): HeadersInit {
  const headers: HeadersInit = {};
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  await ensureCSRFToken(true);
  const data = await apiRequest<{ csrf_token: string; user: AuthUser }>("/login", {
    method: "POST",
    headers: getMutationHeaders(),
    csrf: true,
    body: JSON.stringify({ username, password }),
  });
  if (typeof data.csrf_token !== "string" || !data.csrf_token || !data.user) {
    clearCSRFToken();
    throw new ApiError("Server returned an invalid login response", {
      kind: "parse",
      status: 200,
      code: "invalid_login_response",
    });
  }
  setCSRFToken(data.csrf_token);
  return data.user;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest<void>("/admin/logout", {
      method: "POST",
      headers: getMutationHeaders(),
      csrf: true,
      responseType: "void",
    });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      return;
    }
    throw error;
  } finally {
    clearCSRFToken();
  }
}

// ==================== Post API ====================

export async function getPosts(page = 1, limit = 10, _useAuth = false, sort = "", categoryId = ""): Promise<PaginatedResponse<Post>> {
  const query = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (sort) query.append("sort", sort);
  if (categoryId) query.append("category_id", categoryId);

  return apiRequest<PaginatedResponse<Post>>(`/posts?${query.toString()}`, {
    cache: "no-store",
  });
}

export async function getAdminPosts(
  page = 1,
  limit = 10,
  sort = "admin",
  categoryId = ""
): Promise<PaginatedResponse<Post>> {
  const query = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (sort) query.append("sort", sort);
  if (categoryId) query.append("category_id", categoryId);
  return apiRequest<PaginatedResponse<Post>>(`/admin/posts?${query.toString()}`, {
    cache: "no-store",
    auth: true,
  });
}

export async function getPost(id: string): Promise<Post | null> {
  try {
    return await apiRequest<Post>(`/posts/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function createPost(
  data: { title: string; summary: string; content: string; category_id?: number; status?: string }
): Promise<Post | null> {
  return apiRequest<Post>("/admin/posts", {
    method: "POST",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    body: JSON.stringify(data),
  });
}

export async function updatePost(
  id: number,
  data: { title?: string; summary?: string; content?: string; category_id?: number; status?: string }
): Promise<Post | null> {
  return apiRequest<Post>(`/admin/posts/${id}`, {
    method: "PUT",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    body: JSON.stringify(data),
  });
}

export async function deletePost(id: number): Promise<boolean> {
  await apiRequest<void>(`/admin/posts/${id}`, {
    method: "DELETE",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    responseType: "void",
  });
  return true;
}

// ==================== Category API ====================

export async function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>("/categories", { cache: "no-store" });
}

export async function getAdminCategories(): Promise<Category[]> {
  return apiRequest<Category[]>("/admin/categories", {
    cache: "no-store",
    auth: true,
  });
}

export async function createCategory(name: string): Promise<Category | null> {
  return apiRequest<Category>("/admin/categories", {
    method: "POST",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    body: JSON.stringify({ name }),
  });
}

export async function updateCategory(id: number, name: string): Promise<boolean> {
  await apiRequest<void>(`/admin/categories/${id}`, {
    method: "PUT",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    body: JSON.stringify({ name }),
    responseType: "void",
  });
  return true;
}

export async function deleteCategory(id: number): Promise<boolean> {
  await apiRequest<void>(`/admin/categories/${id}`, {
    method: "DELETE",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    responseType: "void",
  });
  return true;
}

// ==================== File API（云盘） ====================

export async function getFiles(page = 1, limit = 10): Promise<PaginatedResponse<FileRecord>> {
  const query = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
  return apiRequest<PaginatedResponse<FileRecord>>(`/files?${query.toString()}`, {
    cache: "no-store",
  });
}

export async function getAdminFiles(page = 1, limit = 10, includeSystem = true): Promise<PaginatedResponse<FileRecord>> {
  const query = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    include_system: includeSystem ? "true" : "false",
  });
  return apiRequest<PaginatedResponse<FileRecord>>(`/admin/files?${query.toString()}`, {
    cache: "no-store",
    auth: true,
  });
}

export async function uploadFileWithMetadata(
  file: File,
  metadata: { displayName?: string; description?: string } = {},
  isSystem = false,
): Promise<FileMutationResult> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    if (metadata.displayName) formData.append("display_name", metadata.displayName);
    if (metadata.description) formData.append("description", metadata.description);
    const path = isSystem ? "/admin/files?system=true" : "/admin/files";
    const fileRecord = await apiRequest<FileRecord>(path, {
      method: "POST",
      auth: true,
      csrf: true,
      headers: getMutationHeaders(true),
      body: formData,
    });
    return { ok: true, file: fileRecord };
  } catch (error) {
    return fileMutationFailure(error, "Failed to upload file");
  }
}

export async function uploadFile(file: File, isSystem = false): Promise<FileRecord | null> {
  const result = await uploadFileWithMetadata(file, {}, isSystem);
  if (!result.ok || !result.file) {
    throw new ApiError(result.error || "Failed to upload file", {
      kind: result.kind || "http",
      status: result.status,
      code: result.code,
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
  return result.file;
}

export async function updateFileMetadata(
  id: number,
  displayName: string,
  description: string,
): Promise<FileMutationResult> {
  try {
    const fileRecord = await apiRequest<FileRecord>(`/admin/files/${id}`, {
      method: "PUT",
      auth: true,
      csrf: true,
      headers: getMutationHeaders(),
      body: JSON.stringify({ display_name: displayName, description }),
    });
    return { ok: true, file: fileRecord };
  } catch (error) {
    if (isApiError(error) && (error.status === 404 || error.status === 405) && !error.code) {
      return {
        ok: false,
        status: error.status,
        kind: error.kind,
        code: "file_metadata_endpoint_unavailable",
        error: "File details cannot be updated because the running backend is out of date. Restart the backend and try again.",
      };
    }
    return fileMutationFailure(error, "Failed to update file details");
  }
}

export function getDownloadUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/download`;
}

export async function deleteFile(id: number): Promise<FileMutationResult> {
  try {
    await apiRequest<void>(`/admin/files/${id}`, {
        method: "DELETE",
        auth: true,
        csrf: true,
        headers: getMutationHeaders(),
        responseType: "void",
    });
    return { ok: true };
  } catch (error) {
    return fileMutationFailure(error, "Failed to delete file");
  }
}

// ==================== 搜索 API ====================

export async function searchResources(
  query: string,
  scope: "posts" | "files" | "all" = "all",
  categoryId = "",
): Promise<SearchResult> {
  const searchParams = new URLSearchParams({ q: query, scope });
  if (categoryId) searchParams.set("category_id", categoryId);
  return apiRequest<SearchResult>(`/search?${searchParams.toString()}`, {
    cache: "no-store",
  });
}

export async function searchAdminResources(
  query: string,
  scope: "posts" | "files" | "all" = "all",
  includeSystem = true
): Promise<SearchResult> {
  const searchParams = new URLSearchParams({
    q: query,
    scope,
    include_system: includeSystem ? "true" : "false",
  });
  return apiRequest<SearchResult>(`/admin/search?${searchParams.toString()}`, {
    cache: "no-store",
    auth: true,
  });
}

// ==================== Settings API ====================

export async function getSettings(): Promise<Record<string, string>> {
  return apiRequest<Record<string, string>>("/settings", { cache: "no-store" });
}

export async function getCurrentUser(): Promise<{ id: number; username: string; role: string } | null> {
  try {
    return await apiRequest<AuthUser>("/admin/me", { cache: "no-store" });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      clearCSRFToken();
      return null;
    }
    throw error;
  }
}

export async function updateSettings(data: Record<string, string>): Promise<boolean> {
  await apiRequest<void>("/admin/settings", {
    method: "PUT",
    auth: true,
    csrf: true,
    headers: getMutationHeaders(),
    body: JSON.stringify(data),
    responseType: "void",
  });
  return true;
}

export async function updatePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string; code?: string; status?: number | null }> {
  try {
    await apiRequest<void>("/admin/password", {
      method: "PUT",
      auth: true,
      csrf: true,
      headers: getMutationHeaders(),
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      responseType: "void",
    });
    clearCSRFToken();
    return { success: true };
  } catch (error) {
    if (isApiError(error) && error.kind === "http") {
      return {
        success: false,
        error: error.message,
        code: error.code,
        status: error.status,
      };
    }
    throw error;
  }
}
