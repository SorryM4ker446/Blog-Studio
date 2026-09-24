import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";

for (const kind of ["posts", "files"] as const) for (const width of [1440, 375]) {
  test(`${kind} at ${width}px search moves results and pagination together like advanced search`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(kind === "posts" ? "/posts" : "/drive");
    await page.route("**/api/search?**", async route => {
      const number = Number(new URL(route.request().url()).searchParams.get("page"));
      const count = number === 2 ? 1 : 10;
      const date = "2026-09-12T00:00:00Z";
      const rows = Array.from({ length: count }, (_, i) => kind === "posts"
        ? { id: i + 1, title: `Result ${i}`, summary: "", slug: `result-${i}`, category_id: null, category: null, status: "published", published_at: date, last_edited_at: null, created_at: date, updated_at: date }
        : { id: i + 1, orig_name: `result-${i}.txt`, display_name: `Result ${i}`, description: "", mime_type: "text/plain", size: 32, created_at: date, is_system: false });
      await route.fulfill({ json: { posts: kind === "posts" ? rows : [], files: kind === "files" ? rows : [], posts_total: kind === "posts" ? 11 : 0, files_total: kind === "files" ? 11 : 0, total: 11, page: number, limit: 10 } });
    });
    const input = page.getByRole("textbox", { name: kind === "posts" ? "Search posts..." : "Search files..." });
    await input.fill("short");
    await input.press("Enter");
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
    const content = page.locator("[data-result-page]");
    await expect.poll(() => content.evaluate(n => n.parentElement!.getAnimations({ subtree: true }).filter(a => a.playState === "running" || a.pending).length)).toBe(0);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(content).toHaveAttribute("data-result-page", "2");
    await expect.poll(() => content.evaluate(n => n.parentElement!.getAnimations({ subtree: true }).filter(a => a.playState === "running" || a.pending).length)).toBe(0);
    const region = page.getByRole("region", { name: kind === "posts" ? "Posts" : "Files", exact: true });
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = original.call(this, frames, options);
        if (["Posts", "Files"].includes(this.getAttribute("aria-label") || "")) animation.pause();
        return animation;
      };
    });
    const oldHeight = await region.evaluate(node => node.getBoundingClientRect().height);
    await input.fill("long");
    await input.press("Enter");
    await expect.poll(() => region.evaluate(node => node.getAnimations().some(a => a.playState === "paused"))).toBe(true);
    await expect(content).toHaveAttribute("data-result-page", "2");
    await expect(page.getByText("Result 9", { exact: true })).toHaveCount(0);
    expect(await region.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(oldHeight, 0);
    await region.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(content).toHaveAttribute("data-result-page", "1");
    await expect.poll(() => region.evaluate(node => node.getAnimations().some(a => a.playState === "paused"))).toBe(true);
    const entry = await region.evaluate(node => {
      const animation = node.getAnimations()[0];
      animation.currentTime = 0;
      const startOpacity = Number(getComputedStyle(node).opacity);
      animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
      return { startOpacity, opacity: Number(getComputedStyle(node).opacity), offset: new DOMMatrix(String((animation.effect as KeyframeEffect).getKeyframes()[0].transform)).m42, height: node.getBoundingClientRect().height };
    });
    expect(entry.startOpacity).toBe(0);
    expect(entry.opacity).toBeGreaterThan(0);
    expect(entry.opacity).toBeLessThan(1);
    expect(entry.offset).toBe(8);
    expect(entry.height).toBeGreaterThan(oldHeight + 100);
    await expect(page.locator("[data-result-outgoing]")).toHaveCount(0);
    await expect(content).toHaveCount(1);
    expect(await content.evaluate(node => node.getAnimations().length + node.parentElement!.getAnimations().length)).toBe(0);
    await page.screenshot({ path: path.join(os.tmpdir(), `blog-search-shared-${kind}-${width}.png`) });
    await region.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(region).toHaveCSS("opacity", "1");
    await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  });
}
