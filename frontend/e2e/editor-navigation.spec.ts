import { createArticle } from "./support/articles";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("editor URLs restore saved articles and new drafts through refresh and history", async ({ page }) => {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const name = `Editor navigation ${Date.now()}`;
  const categoryResponse = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name } });
  expect(categoryResponse.ok()).toBeTruthy();
  const category = await categoryResponse.json();
  const posts: { id: number; title: string; content: string }[] = [];
  try {
    for (const status of ["draft", "published"]) {
      const response = await createArticle(page.request, {
        headers, data: { title: `${name} ${status}`, content: `Saved ${status} body`, status, category_id: category.id },
      });
      expect(response.ok()).toBeTruthy();
      posts.push(await response.json());
    }
    const [draft, published] = posts;
    const listURL = `/editor?tab=posts&q=${encodeURIComponent(name)}&category=${category.id}&file_page=4`;
    await page.goto(listURL);
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state))).toBe(true);
    await page.getByRole("button", { name: `Open ${draft.title}`, exact: true }).click();
    const body = page.locator(".custom-editor-wrapper textarea");
    await expect(body).toHaveValue(draft.content);
    expect(new URL(page.url()).searchParams.get("edit")).toBe(String(draft.id));
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("edit")).toBe(false);
    await page.goForward();
    await expect(body).toHaveValue(draft.content);
    const reload = await page.reload();
    expect(await reload!.text()).toContain("Loading article");
    await expect(body).toHaveValue(draft.content);
    expect(new URL(page.url()).searchParams.get("q")).toBe(name);
    expect(new URL(page.url()).searchParams.get("category")).toBe(String(category.id));
    expect(new URL(page.url()).searchParams.get("file_page")).toBe("4");

    await page.goto(`${listURL}&edit=${published.id}`);
    await expect(body).toHaveValue(published.content);
    await page.reload();
    await expect(body).toHaveValue(published.content);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("edit")).toBe(String(published.id));
    await page.getByRole("button", { name: "Back to content list" }).click();

    await page.getByRole("button", { name: "+ New Post" }).click();
    expect(new URL(page.url()).searchParams.get("edit")).toBe("new");
    await page.reload();
    await expect(page.getByRole("heading", { name: "New Post", exact: true })).toBeVisible();
    await page.getByLabel("POST TITLE").fill(`${name} new`);
    await body.fill("Saved new draft body");
    const createdResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/posts");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const created = await (await createdResponse).json();
    posts.push(created);
    await expect(page.locator("#post-save-message")).toHaveAttribute("role", "status");
    expect(new URL(page.url()).searchParams.get("edit")).toBe(String(created.id));
    await page.reload();
    await expect(body).toHaveValue("Saved new draft body");
    await page.getByRole("button", { name: "Back to content list" }).click();
    await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe(name);

    await page.goto(`${listURL}&edit=999999999`);
    await expect(page.getByText("Article could not be loaded", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to content list" }).click();
    expect(new URL(page.url()).searchParams.has("edit")).toBe(false);
  } finally {
    for (const post of posts) await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
  }
});
