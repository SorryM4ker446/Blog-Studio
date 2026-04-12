// lib/api.ts
const API_BASE = "http://localhost:8080/api";

interface Category {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

interface Post {
  id: number;
  title: string;
  slug: string;
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

export type { Category, Post, FileRecord, SearchResult };

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

export async function getPosts(useAuth = false): Promise<Post[]> {
  try {
    const options: RequestInit = { cache: "no-store" };
    if (useAuth) {
      options.headers = getAuthHeaders();
    }
    const res = await fetch(`${API_BASE}/posts`, options);
    if (!res.ok) throw new Error("Backend error");
    return await res.json();
  } catch {
    return [
      {
        id: 101,
        title: "Hello World: 博客的第一篇文章",
        slug: "hello-world",
        content: "这是一篇 Mock 数据，后端启动后会自动替换。",
        category_id: 1,
        category: { id: 1, name: "Life & Reading", description: "", created_at: "" },
        status: "published",
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
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
  data: { title: string; content: string; category_id?: number; status?: string }
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
  data: { title?: string; content?: string; category_id?: number; status?: string }
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

// ==================== File API（云盘） ====================

export async function getFiles(): Promise<FileRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/files`, { cache: "no-store" });
    if (!res.ok) throw new Error("Backend error");
    return await res.json();
  } catch {
    return [];
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
