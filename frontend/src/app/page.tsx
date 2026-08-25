import HomePageClient from "@/components/HomePageClient";
import type { PaginatedResponse, Post } from "@/lib/api";
import { requestServerJSON } from "@/lib/server-api";

async function loadRecentPosts(): Promise<Post[]> {
  const query = new URLSearchParams({ page: "1", limit: "5" });
  const result = await requestServerJSON<PaginatedResponse<Post>>(`/posts?${query.toString()}`);
  if (!result.ok || !Array.isArray(result.data.data)) {
    throw new Error("Recent posts response was invalid");
  }
  return result.data.data;
}

async function resolveInitialRecentPosts(): Promise<{
  posts: Post[];
  error: string;
}> {
  try {
    return { posts: await loadRecentPosts(), error: "" };
  } catch {
    return { posts: [], error: "Could not load recent articles." };
  }
}

export default async function Home() {
  const initialState = await resolveInitialRecentPosts();
  return (
    <HomePageClient
      initialPosts={initialState.posts}
      initialPostsError={initialState.error}
    />
  );
}
