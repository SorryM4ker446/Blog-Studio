import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/accessibility";

test("submitting an editor search starts each result at the top", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await loginAdmin(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.route("**/api/admin/search?**", route => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const date = "2026-09-12T00:00:00Z";
    const posts = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1, title: `${query} article ${index + 1}`, slug: `${query}-${index + 1}`,
      summary: "Search result", category_id: null, category: null, status: "published",
      published_at: date, last_edited_at: null, created_at: date, updated_at: date,
    }));
    return route.fulfill({ json: { posts, files: [], posts_total: 10, files_total: 0, total: 10, page: 1, limit: 10 } });
  });

  await page.goto("/editor");
  expect(await page.title()).not.toBe("");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Search posts..." });
  const scroll = page.locator(".content-scroll");
  const firstResult = page.locator(".editor-post-card").first();

  for (const [index, query] of ["alpha", "beta", "alpha"].entries()) {
    await input.fill(query);
    if (index > 0) {
      await scroll.evaluate(node => { node.scrollTop = 240; });
      expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    }
    await page.keyboard.press("Enter");
    await expect(firstResult.getByText(`${query} article 1`, { exact: true })).toBeVisible();
    await expect(scroll).toHaveJSProperty("scrollTop", 0);
  }
  await expect(page.locator("#editor-resource-panel")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-search-scroll-top.png") });

  await page.goBack();
  await expect(page).toHaveURL(/q=beta/);
  await expect(firstResult.getByText("beta article 1", { exact: true })).toBeVisible();
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(240);

  await page.setViewportSize({ width: 375, height: 650 });
  await input.fill("gamma");
  await scroll.evaluate(node => { node.scrollTop = 240; });
  expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press("Enter");
  await expect(firstResult.getByText("gamma article 1", { exact: true })).toBeVisible();
  await expect(scroll).toHaveJSProperty("scrollTop", 0);
  await expect(page.locator("#editor-resource-panel")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-search-scroll-top-mobile.png") });
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
  expect(errors).toEqual([]);
});
