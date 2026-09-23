import { expect, test } from "@playwright/test";
import { E2E_APP_URL } from "./support/test-env";

for (const motion of ["no-preference", "reduce"] as const) {
  test(`category expansion reverses smoothly and excludes hidden links with ${motion} motion`, async ({ page, context }, info) => {
    await page.emulateMedia({ reducedMotion: motion });
    await context.addCookies([{ name: "sidebar_posts_expanded", value: "true", url: E2E_APP_URL }]);
    await page.goto("/search");
    await page.route("**/api/categories", route => route.fulfill({ json: Array.from({ length: 8 }, (_, i) => ({ id: i + 100, name: `Motion category ${i + 1}`, post_count: 10 - i })) }));
    await page.evaluate(() => window.dispatchEvent(new Event("blog:refresh-sidebar")));
    const sidebar = page.locator("aside.sidebar");
    const extra = sidebar.locator(".sidebar-categories-extra");
    const button = sidebar.getByRole("button", { name: "More", exact: true });
    await expect(button).toBeVisible();
    await expect(sidebar.getByRole("link", { name: /Motion category/ })).toHaveCount(3);
    await expect.poll(() => extra.evaluate(node => node.getBoundingClientRect().height)).toBe(0);
    const labelX = (await button.locator(".sidebar-categories-more-label").boundingBox())!.x;
    expect(labelX).toBeCloseTo((await sidebar.locator(".sidebar-category-name").first().boundingBox())!.x, 0);
    await button.click();
    expect((await sidebar.getByRole("button", { name: "Less", exact: true }).locator(".sidebar-categories-more-label").boundingBox())!.x).toBeCloseTo(labelX, 0);
    await expect(sidebar.getByRole("button", { name: "Less", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("link", { name: /Motion category/ })).toHaveCount(8);
    if (motion === "no-preference") {
      const height = await extra.evaluate(node => {
        const animation = node.getAnimations().find(item => (item as CSSTransition).transitionProperty === "grid-template-rows")!;
        animation.pause(); animation.currentTime = 120;
        return { current: node.getBoundingClientRect().height, full: node.firstElementChild!.scrollHeight };
      });
      expect(height.current).toBeGreaterThan(0);
      expect(height.current).toBeLessThan(height.full);
    }
    await sidebar.getByRole("button", { name: "Less", exact: true }).press("Enter");
    await expect(extra).toHaveAttribute("inert");
    await expect(sidebar.getByRole("link", { name: /Motion category/ })).toHaveCount(3);
    await expect.poll(() => extra.evaluate(node => node.getBoundingClientRect().height)).toBe(0);
    await expect(button).toBeFocused();
    if (motion === "reduce") expect(await extra.evaluate(node => node.getAnimations().length)).toBe(0);
    const categories = sidebar.locator(".sidebar-categories");
    await expect(sidebar.locator(".sidebar-categories-preview")).toHaveCount(0);
    await page.getByRole("heading", { name: "Search", exact: true }).click();
    await categories.screenshot({ path: info.outputPath("categories-more-dark.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await categories.screenshot({ path: info.outputPath("categories-more-light.png"), animations: "disabled" });
    await button.click();
    const less = sidebar.getByRole("button", { name: "Less", exact: true });
    await expect(less).toHaveCSS("border-top-width", "0px");
    await page.getByRole("heading", { name: "Search", exact: true }).click();
    await categories.screenshot({ path: info.outputPath("categories-less-light.png"), animations: "disabled" });
  });

  test(`keyword results enter and replace outgoing content with ${motion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto("/search");
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      const records: { section: boolean; frames: Keyframe[] }[] = [];
      Object.assign(window, { resultEntryRecords: records });
      Element.prototype.animate = function (frames, options) {
        if (this.getAttribute("aria-label") === "Search results" || this.hasAttribute("data-result-page")) {
          records.push({ section: this.getAttribute("aria-label") === "Search results", frames: frames as Keyframe[] });
        }
        return animate.call(this, frames, options);
      };
    });
    let release!: () => void;
    let gate: Promise<void> | null = null;
    await page.route("**/api/search?**", async route => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get("q");
      if (gate) await gate;
      const date = "2026-09-12T00:00:00Z";
      const posts = params.get("scope") === "posts" && query !== "empty" ? [{ id: 1, title: `${query} article`, summary: "", slug: "entry", status: "published", category_id: null, category: null, published_at: date, last_edited_at: null, created_at: date, updated_at: date }] : [];
      await route.fulfill({ json: { posts, files: [], posts_total: posts.length, files_total: 0, total: posts.length, page: 1, limit: 10 } });
    });
    const input = page.getByRole("textbox", { name: "Search posts and files" });
    const results = page.locator('section[aria-label="Search results"]');
    gate = new Promise(resolve => { release = resolve; });
    await input.fill("first"); await input.press("Enter");
    await expect(results.locator(".skeleton-pulse")).toHaveCount(0);
    await expect(results.getByRole("status")).toHaveText("Searching posts and files…");
    await expect(results.getByRole("status")).toHaveClass("sr-only");
    await expect(results.getByRole("status")).toHaveCSS("clip", "rect(0px, 0px, 0px, 0px)");
    await expect(results.getByRole("status")).toBeVisible();
    gate = null; release();
    await expect(results).toContainText("first article");
    await expect(results).toHaveCSS("opacity", "1");
    const firstFrames = await page.evaluate(() => (window as unknown as { resultEntryRecords: { frames: Keyframe[] }[] }).resultEntryRecords);
    expect(firstFrames.filter(item => item.frames.at(-1)?.opacity === 0)).toHaveLength(0);
    await expect(results.getByText("Searching posts and files…")).toHaveCount(0);
    gate = new Promise(resolve => { release = resolve; });
    await input.fill("second"); await input.press("Enter");
    await expect(results).toHaveAttribute("inert");
    await expect(results).toContainText("first article");
    await expect(results).toHaveCSS("opacity", "1");
    gate = null; release();
    await expect(results).toContainText("second article");
    await expect(results).not.toHaveAttribute("inert");
    await expect(results).toHaveCSS("opacity", "1");
    await input.fill("empty"); await input.press("Enter");
    await expect(results).toContainText("No matching posts found.");
    await expect(results).toHaveCSS("opacity", "1");
    const records = await page.evaluate(() => (window as unknown as { resultEntryRecords: { section: boolean; frames: Keyframe[] }[] }).resultEntryRecords);
    expect(records.filter(item => !item.section)).toHaveLength(0);
    if (motion === "reduce") expect(records).toHaveLength(0);
    else {
      expect(records.filter(item => item.frames.at(-1)?.opacity === 0).length).toBeGreaterThanOrEqual(2);
      expect(records.filter(item => Number(item.frames[0].opacity) === 0 && item.frames.at(-1)?.opacity === 1).length).toBeGreaterThanOrEqual(3);
    }
    await expect(input).toBeFocused();
  });
}
