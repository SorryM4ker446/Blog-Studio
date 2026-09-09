import { createArticle } from "./support/articles";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("search pages restore filters and editor deletion corrects the last page", async ({ page, request }) => {
  test.setTimeout(180_000);
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const q = `pagedneedle${Date.now()}`;
  const postIds: number[] = [], fileIds: number[] = [];
  let categoryId = 0;
  try {
    const category = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name: q } });
    expect(category.ok()).toBeTruthy(); categoryId = (await category.json()).id;
    for (let i = 0; i < 14; i++) {
      const response = await createArticle(page.request, { headers, data: {
        title: `${q} article ${i}`, content: `# Visible ${q}\n\n${"Long paragraph. ".repeat(800)}`,
        status: i < 12 ? "published" : "draft", category_id: i < 11 ? categoryId : 0,
      } });
      expect(response.ok()).toBeTruthy(); postIds.push((await response.json()).id);
    }
    for (let i = 0; i < 12; i++) {
      const response = await page.request.post(`${E2E_API_URL}/admin/files?system=${i === 11}`, { headers, multipart: {
        file: { name: `${q}-${i}.txt`, mimeType: "text/plain", buffer: Buffer.from("Search pagination fixture") },
        display_name: `${q} file ${i}`,
      } });
      expect(response.status()).toBe(201); fileIds.push((await response.json()).id);
    }
    const first = await request.get(`${E2E_API_URL}/search`, { params: { q } });
    const firstPage = await first.json();
    expect(firstPage).toMatchObject({ total: 23, posts_total: 12, files_total: 11, page: 1, limit: 10 });
    expect(firstPage.posts.length + firstPage.files.length).toBe(10);
    expect(firstPage.files.every((file: { is_system: boolean }) => !file.is_system)).toBeTruthy();

    const postsURL = `/posts?q=${q}&category=${categoryId}&page=2`;
    const postsResponse = await page.goto(postsURL);
    expect(await postsResponse!.text()).toContain(`${q} article 0`);
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    const postSearch = page.getByRole("textbox", { name: "Search posts..." });
    await expect(postSearch).toHaveValue(q);
    await page.getByRole("link").filter({ hasText: `${q} article 0` }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${postIds[0]}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`category=${categoryId}.*page=2`));
    await expect(postSearch).toHaveValue(q);
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();

    await page.goto(`/drive?q=${q}`);
    await expect(page.locator("[data-file-id]")).toHaveCount(10);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator("[data-file-id]")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.goBack();
    await expect(page.locator("[data-file-id]")).toHaveCount(10);
    await page.goForward();
    await expect(page.locator("[data-file-id]")).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Search files..." })).toHaveValue(q);
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();

    await page.goto(`/search?q=${q}`);
    const results = page.getByRole("region", { name: "Search results" });
    await expect(results.getByText("Posts (12 results)", { exact: true })).toBeVisible();
    await expect(results.locator('a[href^="/posts/"]').or(results.locator("[data-file-id]"))).toHaveCount(10);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    let releaseFilterRequest!: () => void;
    const filterRequestBlocked = new Promise<void>((resolve) => { releaseFilterRequest = resolve; });
    await page.route(/\/api\/search\?/, async (route) => {
      const url = new URL(route.request().url());
      const isFilteredSearch = url.pathname === "/api/search"
        && url.searchParams.get("scope") === "posts"
        && !url.searchParams.has("category_id");
      if (isFilteredSearch) await filterRequestBlocked;
      await route.continue();
    });
    await page.getByRole("combobox", { name: "Search scope" }).click();
    await page.getByRole("option", { name: "Posts", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("page")).toBe(false);
    await expect(results.locator("[data-file-id]")).toHaveCount(1);
    await expect(results).toHaveAttribute("aria-busy", "true");
    releaseFilterRequest();
    await expect(results.locator('a[href^="/posts/"]')).toHaveCount(10);
    await page.getByRole("combobox", { name: "Search category" }).click();
    await page.getByRole("option", { name: q, exact: true }).click();
    await expect(results.getByText("Posts (11 results)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(results.locator('a[href^="/posts/"]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Search scope" })).toHaveText(/^Posts/);
    await expect(page.getByRole("combobox", { name: "Search category" })).toContainText(q);
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();

    await page.goto(`/editor?tab=posts&q=${q}&category=${categoryId}&post_page=2&file_page=2`);
    await expect(page.locator(".editor-post-card")).toHaveCount(1);
    await page.getByRole("tab", { name: /Files \(/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
    expect(new URL(page.url()).searchParams.has("file_page")).toBe(false);
    expect(new URL(page.url()).searchParams.has("category")).toBe(false);
    await page.goBack();
    await expect(page.locator(".editor-post-card")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".editor-post-card")).toHaveCount(1);
    const deleteResponse = page.waitForResponse((response) => response.url() === `${E2E_API_URL}/admin/posts/${postIds[0]}` && response.request().method() === "DELETE");
    await page.getByRole("button", { name: `Delete ${q} article 0`, exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    expect((await deleteResponse).ok()).toBeTruthy(); postIds.shift();
    await expect(page.locator(".editor-post-card")).toHaveCount(10);
    await expect.poll(() => new URL(page.url()).searchParams.has("post_page")).toBe(false);
    expect(new URL(page.url()).searchParams.get("q")).toBe(q);
    expect(new URL(page.url()).searchParams.get("category")).toBe(String(categoryId));
  } finally {
    for (const id of postIds) expect((await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers })).ok()).toBeTruthy();
    for (const id of fileIds) expect((await page.request.delete(`${E2E_API_URL}/admin/files/${id}`, { headers })).ok()).toBeTruthy();
    if (categoryId) expect((await page.request.delete(`${E2E_API_URL}/admin/categories/${categoryId}`, { headers })).ok()).toBeTruthy();
  }
});
