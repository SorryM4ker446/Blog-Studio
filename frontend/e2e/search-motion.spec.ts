import { expect, test } from "@playwright/test";
import { E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`search paging stays stable and transitions independently in ${theme} mode`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.goto("/search");
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      const records: { page: string; frames: Keyframe[] }[] = [];
      Object.assign(window, { searchMotionRecords: records });
      Element.prototype.animate = function (frames, options) {
        if (this.hasAttribute("data-result-page")) records.push({ page: this.getAttribute("data-result-page")!, frames: frames as Keyframe[] });
        return original.call(this, frames, options);
      };
    });
    let release!: () => void;
    let gate: Promise<void> | null = null;
    await page.route("**/api/search?**", async route => {
      const url = new URL(route.request().url());
      const scope = url.searchParams.get("scope");
      const number = Number(url.searchParams.get("page"));
      if (gate) await gate;
      const date = "2026-09-12T00:00:00Z";
      const posts = scope === "posts" ? Array.from({ length: number === 1 ? 10 : 1 }, (_, i) => ({
        id: (number - 1) * 10 + i + 1, title: `Search article ${(number - 1) * 10 + i + 1}`, slug: `post-${i}`,
        summary: "Search fixture", category_id: null, category: null, status: "published", published_at: date,
        last_edited_at: null, created_at: date, updated_at: date,
      })) : [];
      await route.fulfill({ json: { posts, files: [], posts_total: scope === "posts" ? 11 : 0, files_total: 0,
        total: scope === "posts" ? 11 : 0, page: number, limit: 10 } });
    });
    await page.getByRole("textbox", { name: "Search posts and files" }).fill("motion");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const posts = page.locator('section[aria-label="Post results"]');
    const next = posts.getByRole("button", { name: "Next page", includeHidden: true });
    const previous = posts.getByRole("button", { name: "Previous page", includeHidden: true });
    await expect(posts.locator('a[href^="/posts/"]')).toHaveCount(10);
    await expect(next).toBeEnabled();
    await expect.poll(() => page.locator('section[aria-label="Search results"]')
      .evaluate(section => section.getAnimations().length)).toBe(0);
    const card = await posts.locator(".ai-card").first().boundingBox();
    expect((await previous.boundingBox())!.x + (await previous.boundingBox())!.width).toBeLessThan(card!.x);
    expect((await next.boundingBox())!.x).toBeGreaterThan(card!.x + card!.width);
    const before = await next.evaluate(button => {
      button.setAttribute("data-stable-control", "original");
      return { opacity: getComputedStyle(button).opacity, box: button.getBoundingClientRect().toJSON() };
    });
    gate = new Promise(resolve => { release = resolve; });
    await page.getByRole("combobox", { name: "Search scope" }).click();
    // Wait for the popup entrance before clicking so retry scroll alignment cannot move the page.
    await expect.poll(() => page.getByRole("listbox", { name: "Search scope" })
      .evaluate(menu => menu.parentElement!.getAnimations().length)).toBe(0);
    await page.getByRole("option", { name: "Posts", exact: true }).click();
    await expect(next).toBeDisabled();
    await expect(next).toHaveAttribute("data-stable-control", "original");
    await expect(next).toHaveCSS("opacity", before.opacity);
    expect(await next.evaluate(button => button.getAnimations().length)).toBe(0);
    expect((await next.boundingBox())!.y).toBeCloseTo(before.box.y, 0);
    gate = null; release();
    await expect(page.locator('section[aria-label="Search results"]')).not.toHaveAttribute("inert");
    await expect(next).toBeEnabled();
    await expect(next).toHaveAttribute("data-stable-control", "original");
    await expect(next).toHaveCSS("opacity", before.opacity);
    expect(await page.evaluate(() => (window as unknown as { searchMotionRecords: unknown[] }).searchMotionRecords.length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("side-pagination.png"), fullPage: true, animations: "disabled" });

    await next.click();
    await expect(posts.locator('a[href^="/posts/"]')).toHaveCount(1);
    await expect(posts.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    const forward = await page.evaluate(() => (window as unknown as { searchMotionRecords: { page: string; frames: Keyframe[] }[] }).searchMotionRecords);
    expect(forward.at(-1)?.frames[0].transform).toBe("translateX(14px)");
    await expect.poll(() => posts.locator("[data-result-page]").evaluate(node => node.getAnimations().length)).toBe(0);
    await previous.click();
    await expect(posts.locator('a[href^="/posts/"]')).toHaveCount(10);
    const backward = await page.evaluate(() => (window as unknown as { searchMotionRecords: { page: string; frames: Keyframe[] }[] }).searchMotionRecords);
    expect(backward.at(-1)?.frames[0].transform).toBe("translateX(-14px)");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const count = backward.length;
    await next.click();
    await expect(posts.locator('a[href^="/posts/"]')).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { searchMotionRecords: unknown[] }).searchMotionRecords.length)).toBe(count);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("combobox", { name: "Search scope" }).click();
    await page.getByRole("option", { name: "Posts and files", exact: true }).click();
    await expect(posts.getByRole("button", { name: "Page 1, current page" })).toBeVisible();
    await expect(page.locator('section[aria-label="Search results"]')).not.toHaveAttribute("inert");
    expect(await page.evaluate(() => (window as unknown as { searchMotionRecords: unknown[] }).searchMotionRecords.length)).toBe(count);
    await page.setViewportSize({ width: 760, height: 1000 });
    // Read both rectangles in one frame because resize can change scroll anchoring.
    const paginationGap = await posts.evaluate(section => {
      const list = section.querySelector("[data-result-page]")!.getBoundingClientRect();
      const previous = section.querySelector('button[aria-label="Previous page"]')!.getBoundingClientRect();
      return previous.top - list.bottom;
    });
    expect(paginationGap).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
