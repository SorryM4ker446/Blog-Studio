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

export type { Category, Post };

export async function getPosts(): Promise<Post[]> {
  try {
    const res = await fetch(`${API_BASE}/posts`, { cache: "no-store" });
    if (!res.ok) throw new Error("Backend error");
    return await res.json();
  } catch {
    // 优雅降级：后端未运行时展示 Mock 数据
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

export async function getCategories(): Promise<Category[]> {
  try {
    const res = await fetch(`${API_BASE}/categories`, { cache: "no-store" });
    if (!res.ok) throw new Error("Backend error");
    return await res.json();
  } catch {
    return [];
  }
}
