import { expect, type APIRequestContext } from "@playwright/test";
import { E2E_API_URL } from "./test-env";

export async function createArticle(request: APIRequestContext, options: {
  headers: Record<string, string>;
  data: Record<string, unknown>;
}) {
  const { status, ...data } = options.data;
  const draft = await request.post(`${E2E_API_URL}/admin/posts`, { headers: options.headers, data });
  expect(draft.status()).toBe(201);
  if (status !== "published") return draft;
  const post = await draft.json();
  const published = await request.post(`${E2E_API_URL}/admin/posts/${post.id}/publish`, {
    headers: options.headers, data: { version: post.version },
  });
  expect(published.status()).toBe(200);
  return published;
}
