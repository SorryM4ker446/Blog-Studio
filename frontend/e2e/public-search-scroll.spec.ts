import { expect, test } from "@playwright/test";

for (const entry of [
  { path: "/search", input: "Search posts and files", region: "Search results", kind: "article" },
  { path: "/posts", input: "Search posts...", region: "Posts", kind: "article" },
  { path: "/drive", input: "Search files...", region: "Files", kind: "file" },
] as const) {
  test(`${entry.path} starts submitted searches at the top and restores history scroll`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.route("**/api/search?**", route => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get("q") || "";
      const scope = params.get("scope");
      const date = "2026-09-12T00:00:00Z";
      const posts = scope === "files" ? [] : Array.from({ length: 10 }, (_, index) => ({
        id: index + 1, title: `${query} article ${index + 1}`, slug: `${query}-${index + 1}`,
        summary: "Search result", category_id: null, category: null, status: "published",
        published_at: date, last_edited_at: null, created_at: date, updated_at: date,
      }));
      const files = scope === "posts" ? [] : Array.from({ length: 10 }, (_, index) => ({
        id: index + 1, orig_name: `${query}-${index + 1}.txt`, display_name: `${query} file ${index + 1}`,
        description: "Search result", mime_type: "text/plain", size: 10, created_at: date, is_system: false,
      }));
      return route.fulfill({ json: { posts, files, posts_total: posts.length, files_total: files.length,
        total: posts.length + files.length, page: 1, limit: 10 } });
    });

    await page.goto(entry.path);
    expect(await page.title()).not.toBe("");
    const input = page.getByRole("textbox", { name: entry.input });
    const region = page.getByRole("region", { name: entry.region, exact: true });
    const scroll = page.locator(".content-scroll");

    for (const [index, query] of ["alpha", "beta", "alpha"].entries()) {
      await input.fill(query);
      if (index > 0) {
        await scroll.evaluate(node => { node.scrollTop = 240; });
        expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
      }
      await input.press("Enter");
      await expect(region.getByText(`${query} ${entry.kind} 1`, { exact: true }).first()).toBeVisible();
      await expect(scroll).toHaveJSProperty("scrollTop", 0);
    }
    await expect(region).toHaveCSS("opacity", "1");
    await expect.poll(() => region.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("submitted-search-top.png") });

    await page.goBack();
    await expect(page).toHaveURL(/q=beta/);
    await expect(region.getByText(`beta ${entry.kind} 1`, { exact: true }).first()).toBeVisible();
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(240);
    await page.goBack();
    await expect(page).toHaveURL(/q=alpha/);
    await expect(region.getByText(`alpha ${entry.kind} 1`, { exact: true }).first()).toBeVisible();
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(240);

    if (entry.path === "/search") {
      await page.setViewportSize({ width: 375, height: 650 });
      await input.fill("gamma");
      await scroll.evaluate(node => { node.scrollTop = 240; });
      expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
      await input.press("Enter");
      await expect(region.getByText("gamma article 1", { exact: true }).first()).toBeVisible();
      await expect(scroll).toHaveJSProperty("scrollTop", 0);
      await expect(region).toHaveCSS("opacity", "1");
      await expect.poll(() => region.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("submitted-search-top-mobile.png") });
    }
    await expect(page.locator("nextjs-portal")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
