import { createArticle } from "./support/articles";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("article summaries stay body-free and editing loads complete content with retry", async ({ page, request }) => {
  const csrfResponse = await page.request.get(`${E2E_API_URL}/csrf`);
  const loginResponse = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrfResponse.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await loginResponse.json()).csrf_token };
  const suffix = Date.now();
  const query = `bodyneedle${suffix}`;
  const bodyMarker = `completebody${suffix}`;
  const content = `# Article body\n\n${query}\n\n${bodyMarker}\n\n${"Long visible paragraph. ".repeat(2048)}`;
  const ids: number[] = [];

  try {
    const articles: { id: number; title: string; status: string }[] = [];
    for (const status of ["published", "draft"]) {
      const created = await createArticle(page.request, {
        headers, data: { title: `Summary ${status} ${suffix}`, summary: "Short description", content, status },
      });
      expect(created.ok()).toBeTruthy();
      const article = await created.json();
      ids.push(article.id);
      articles.push(article);
    }
    const [published, draft] = articles;

    for (const path of ["/posts", `/search?q=${query}&scope=posts`, "/admin/posts", `/admin/search?q=${query}&scope=posts`]) {
      const response = await page.request.get(`${E2E_API_URL}${path}`);
      expect(response.ok()).toBeTruthy();
      const payload = await response.json();
      const posts = payload.data ?? payload.posts;
      expect(posts.length).toBeGreaterThan(0);
      for (const post of posts) expect(post).not.toHaveProperty("content");
      expect(await response.text()).not.toContain(bodyMarker);
    }
    expect((await request.get(`${E2E_API_URL}/posts/${draft.id}`)).status()).toBe(404);
    expect((await request.get(`${E2E_API_URL}/admin/posts/${draft.id}`)).status()).toBe(401);

    for (const path of ["/", "/posts", `/posts?q=${query}`, `/search?q=${query}`, `/editor?tab=posts&q=${query}`]) {
      const response = await page.goto(path);
      const html = await response!.text();
      expect(html).toContain(published.title);
      expect(html).not.toContain(bodyMarker);
      await expect(page.getByText(published.title, { exact: true }).first()).toBeVisible();
    }

    let reads = 0;
    let allowDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => { allowDetail = resolve; });
    await page.route(`**/api/admin/posts/${draft.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      reads++;
      if (reads === 1) return route.fulfill({ status: 503, json: { error: "Temporary article read failure" } });
      await detailGate;
      await route.continue();
    });
    await page.getByRole("button", { name: `Open ${draft.title}`, exact: true }).click();
    await expect(page.getByText("Article could not be loaded")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
    await expect(page.getByText("Loading article…")).toHaveCount(0);
    await expect(page.locator(".editor-opening-icon")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    allowDetail();

    const bodyInput = page.locator(".custom-editor-wrapper textarea");
    await expect(bodyInput).toHaveValue(content);
    expect(reads).toBe(2);
    const updatedContent = `${content}\n\nSaved through the detail editor.`;
    await bodyInput.fill(updatedContent);
    const saveResponse = page.waitForResponse((response) => response.url() === `${E2E_API_URL}/admin/posts/${draft.id}` && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to content list" }).click();
    await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
    const saved = await page.request.get(`${E2E_API_URL}/admin/posts/${draft.id}`);
    expect(await saved.json()).toMatchObject({ id: draft.id, status: "draft", content: updatedContent });
    expect((await request.get(`${E2E_API_URL}/posts/${draft.id}`)).status()).toBe(404);

    const detailResponse = await page.goto(`/posts/${published.id}`);
    expect(await detailResponse!.text()).toContain(bodyMarker);
  } finally {
    for (const id of ids) {
      const response = await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
      expect(response.ok()).toBeTruthy();
    }
  }
});
