// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080/api";

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
  category_id: number;
  category: Category;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FileRecord {
  id: number;
  name: string;
  orig_name: string;
  path: string;
  size: number;
  mime_type: string;
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
export { API_BASE };

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export function getFileViewUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/view`;
}

export function normalizeFileViewUrl(url: string): string {
  if (!url) {
    return url;
  }
  return url.replace(/\/api\/files\/(\d+)\/download\b/g, "/api/files/$1/view");
}

export function normalizeMarkdownFileUrls(markdown: string): string {
  if (!markdown) {
    return markdown;
  }
  return markdown.replace(/\/api\/files\/(\d+)\/download\b/g, "/api/files/$1/view");
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

// Helper get authorization headers
function getAuthHeaders(isFormData = false): HeadersInit {
  const headers: HeadersInit = {};
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("blog_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
}

// ==================== Post API ====================

export async function getPosts(page = 1, limit = 10, useAuth = false, sort = "", categoryId = ""): Promise<PaginatedResponse<Post>> {
  try {
    const options: RequestInit = { cache: "no-store" };
    if (useAuth) {
      options.headers = getAuthHeaders();
    }
    const query = new URLSearchParams({ 
      page: page.toString(), 
      limit: limit.toString() 
    });
    if (sort) query.append("sort", sort);
    if (categoryId) query.append("category_id", categoryId);
    
    const res = await fetch(`${API_BASE}/posts?${query.toString()}`, options);
    if (!res.ok) throw new Error(await readErrorMessage(res, "Backend error"));
    return await res.json();
  } catch (error) {
    return {
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      error: error instanceof Error ? error.message : "Failed to load posts",
    };
  }
}

export async function getAdminPosts(
  page = 1,
  limit = 10,
  sort = "admin",
  categoryId = ""
): Promise<PaginatedResponse<Post>> {
  try {
    const query = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (sort) query.append("sort", sort);
    if (categoryId) query.append("category_id", categoryId);
    const res = await fetch(`${API_BASE}/admin/posts?${query.toString()}`, {
      cache: "no-store",
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load admin posts"));
    return await res.json();
  } catch (error) {
    return {
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      error: error instanceof Error ? error.message : "Failed to load admin posts",
    };
  }
}

export async function getPost(id: string): Promise<Post | null> {
  try {
    const res = await fetch(`${API_BASE}/posts/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Post not found");
    return await res.json();
  } catch {
    return null;
  }
}

export async function createPost(
  data: { title: string; summary: string; content: string; category_id?: number; status?: string }
): Promise<Post | null> {
    const res = await fetch(`${API_BASE}/admin/posts`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Error ${res.status}`);
    }
    return await res.json();
}

export async function updatePost(
  id: number,
  data: { title?: string; summary?: string; content?: string; category_id?: number; status?: string }
): Promise<Post | null> {
    const res = await fetch(`${API_BASE}/admin/posts/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Error ${res.status}`);
    }
    return await res.json();
}

export async function deletePost(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/posts/${id}`, { 
      method: "DELETE",
      headers: getAuthHeaders(), 
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ==================== Category API ====================

export async function getCategories(): Promise<Category[]> {
  try {
    const res = await fetch(`${API_BASE}/categories`, { cache: "no-store" });
    if (!res.ok) throw new Error("Backend error");
    return await res.json();
  } catch {
    return [];
  }
}

export async function getAdminCategories(): Promise<Category[]> {
  try {
    const res = await fetch(`${API_BASE}/admin/categories`, {
      cache: "no-store",
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load admin categories"));
    return await res.json();
  } catch {
    return [];
  }
}

export async function createCategory(name: string): Promise<Category | null> {
    try {
        const res = await fetch(`${API_BASE}/admin/categories`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error("Create failed");
        return await res.json();
    } catch {
        return null;
    }
}

export async function updateCategory(id: number, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/categories/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    });
    return res.ok;
  } catch (error) {
    return false;
  }
}

export async function deleteCategory(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/categories/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (error) {
    return false;
  }
}

// ==================== File API（云盘） ====================

export async function getFiles(page = 1, limit = 10): Promise<PaginatedResponse<FileRecord>> {
  try {
    const res = await fetch(`${API_BASE}/files?page=${page}&limit=${limit}`, { cache: "no-store" });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Backend error"));
    return await res.json();
  } catch (error) {
    return {
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      error: error instanceof Error ? error.message : "Failed to load files",
    };
  }
}

export async function getAdminFiles(page = 1, limit = 10, includeSystem = true): Promise<PaginatedResponse<FileRecord>> {
  try {
    const query = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      include_system: includeSystem ? "true" : "false",
    });
    const res = await fetch(`${API_BASE}/admin/files?${query.toString()}`, {
      cache: "no-store",
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load admin files"));
    return await res.json();
  } catch (error) {
    return {
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      error: error instanceof Error ? error.message : "Failed to load admin files",
    };
  }
}

export async function uploadFile(file: File, isSystem = false): Promise<FileRecord | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const url = isSystem ? `${API_BASE}/admin/files?system=true` : `${API_BASE}/admin/files`;
    const res = await fetch(url, {
      method: "POST",
      headers: getAuthHeaders(true),
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    return await res.json();
  } catch {
    return null;
  }
}

export function getDownloadUrl(fileId: number): string {
  return `${API_BASE}/files/${fileId}/download`;
}

export async function deleteFile(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/admin/files/${id}`, { 
        method: "DELETE",
        headers: getAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ==================== 搜索 API ====================

export async function searchResources(query: string, scope: "posts" | "files" | "all" = "all"): Promise<SearchResult> {
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&scope=${scope}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Search failed");
    return await res.json();
  } catch {
    return { posts: [], files: [] };
  }
}

export async function searchAdminResources(
  query: string,
  scope: "posts" | "files" | "all" = "all",
  includeSystem = true
): Promise<SearchResult> {
  try {
    const searchParams = new URLSearchParams({
      q: query,
      scope,
      include_system: includeSystem ? "true" : "false",
    });
    const res = await fetch(`${API_BASE}/admin/search?${searchParams.toString()}`, {
      cache: "no-store",
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Search failed"));
    return await res.json();
  } catch {
    return { posts: [], files: [] };
  }
}

// ==================== Settings API ====================

export async function getSettings(): Promise<Record<string, string>> {
    try {
        const res = await fetch(`${API_BASE}/settings`, { cache: "no-store" });
        if (!res.ok) throw new Error("Fetch failed");
        return await res.json();
    } catch {
        return {};
    }
}

export async function getCurrentUser(): Promise<{ id: number; username: string; role: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/admin/me`, {
      headers: getAuthHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error("Unauthorized");
    }
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateSettings(data: Record<string, string>): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/admin/settings`, {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify(data),
        });
        return res.ok;
    } catch {
        return false;
    }
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<{success: boolean, error?: string}> {
    try {
        const res = await fetch(`${API_BASE}/admin/password`, {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        });
        const data = await res.json();
        return { success: res.ok, error: data.error };
    } catch {
        return { success: false, error: "Network error" };
    }
}
