import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`idle search stays stable and categories retract with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/search");
    await expect(page).toHaveTitle("Blog Studio");
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const results = page.getByRole("region", { name: "Search results", exact: true });
    const category = page.locator('.search-filter-field[data-open]');
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Object.assign(window, { idleAnimations: 0 });
      Element.prototype.animate = function (frames, options) {
        if (this.getAttribute("aria-label") === "Search results") (window as unknown as { idleAnimations: number }).idleAnimations++;
        return original.call(this, frames, options);
      };
    });
    const choose = async (name: string) => {
      await page.getByRole("combobox", { name: "Search scope" }).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await choose("Posts");
      await expect(category).toHaveCSS("opacity", "1");
      await expect(page.getByRole("combobox", { name: "Search category" })).toBeEnabled();
      await expect(results).toHaveAttribute("aria-busy", "false");
      await page.getByRole("combobox", { name: "Search scope" }).click();
      const exit = await page.getByRole("option", { name: "Posts and files", exact: true }).evaluate(option => {
        (option as HTMLElement).click();
        return new Promise<{ count: number; opacity: number }>(resolve => requestAnimationFrame(() => {
          const node = document.querySelector<HTMLElement>('.search-filter-field[data-open]')!;
          const animations = node.getAnimations();
          for (const animation of animations) { animation.pause(); animation.currentTime = 110; }
          resolve({ count: animations.length, opacity: Number(getComputedStyle(node).opacity) });
        }));
      });
      await expect(category).toHaveAttribute("inert", "");
      await expect(page.getByRole("combobox", { name: "Search category" })).toHaveCount(0);
      if (reducedMotion === "no-preference") {
        expect(exit.count).toBeGreaterThan(0);
        expect(exit.opacity).toBeGreaterThan(0);
        expect(exit.opacity).toBeLessThan(1);
        await page.screenshot({ path: path.join(os.tmpdir(), `search-category-exit-${width}.png`) });
      } else expect(exit.count).toBe(0);
      // Reverse an unfinished exit: no stale completion may hide the active field.
      await choose("Posts");
      await expect(category).toHaveCSS("opacity", "1");
      await expect(category).not.toHaveAttribute("inert");
      await choose("Files");
      await expect(category).toHaveCSS("display", "none");
      await expect(results).toHaveAttribute("aria-busy", "false");
      await expect(results).toHaveCSS("opacity", "1");
      await expect(results).toContainText("Enter a keyword to search across posts and files.");
    }
    expect(await page.evaluate(() => (window as unknown as { idleAnimations: number }).idleAnimations)).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`search scope fades to current results with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/search");
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      const records: Keyframe[][] = [];
      Object.assign(window, { scopeMotionRecords: records });
      Element.prototype.animate = function (frames, options) {
        if (this.getAttribute("aria-label") === "Search results") records.push(frames as Keyframe[]);
        return original.call(this, frames, options);
      };
    });
    let release!: () => void;
    let gate: Promise<void> | null = null;
    let fail = false;
    await page.route("**/api/search?**", async route => {
      const scope = new URL(route.request().url()).searchParams.get("scope");
      if (scope === "posts" && gate) await gate;
      if (fail) { await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }); return; }
      const date = "2026-09-12T00:00:00Z";
      await route.fulfill({ json: {
        posts: scope === "posts" ? [{ id: 1, title: "Scope article", summary: "", slug: "scope-article", status: "published",
          category_id: null, category: null, published_at: date, last_edited_at: null, created_at: date, updated_at: date }] : [],
        files: scope === "files" ? [{ id: 2, orig_name: "scope.txt", display_name: "Scope file", description: "",
          mime_type: "text/plain", size: 10, created_at: date, is_system: false }] : [],
        posts_total: scope === "posts" ? 1 : 0, files_total: scope === "files" ? 1 : 0, total: 1, page: 1, limit: 10,
      } });
    });
    await page.getByRole("textbox", { name: "Search posts and files" }).fill("scope-motion");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const results = page.locator('section[aria-label="Search results"]');
    const posts = results.locator('section[aria-label="Post results"]');
    const files = results.locator('section[aria-label="File results"]');
    await expect(posts).toContainText("Scope article");
    await expect(files).toContainText("Scope file");
    const choose = async (label: string) => {
      await page.getByRole("combobox", { name: "Search scope" }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    gate = new Promise(resolve => { release = resolve; });
    await choose("Posts");
    await expect(results).toHaveAttribute("inert", "");
    await expect(files).toContainText("Scope file");
    await expect(results).toHaveCSS("opacity", "1");
    // A newer scope must win even if the previous response arrives later.
    await choose("Files");
    await expect(results).not.toHaveAttribute("inert");
    await expect(posts).toHaveCount(0);
    await expect(files).toContainText("Scope file");
    gate = null; release();
    await expect(results).toHaveCSS("opacity", "1");
    expect(new URL(page.url()).searchParams.get("scope")).toBe("files");
    await choose("Posts and files");
    await expect(posts).toContainText("Scope article");
    await expect(files).toContainText("Scope file");
    await expect(results).not.toHaveAttribute("inert");
    await expect(results).toHaveCSS("opacity", "1");
    const frames = await page.evaluate(() => (window as unknown as { scopeMotionRecords: Keyframe[][] }).scopeMotionRecords);
    if (reducedMotion === "reduce") expect(frames).toHaveLength(0);
    else {
      expect(frames.some(entry => entry.at(-1)?.opacity === 0)).toBe(true);
      expect(frames.some(entry => Number(entry[0].opacity) === 0 && entry.at(-1)?.opacity === 1)).toBe(true);
      expect(frames.some(entry => entry.at(-1)?.transform === "translateY(-6px)")).toBe(true);
      expect(frames.some(entry => entry[0].transform === "matrix(1, 0, 0, 1, 0, 8)")).toBe(true);
    }
    await page.goBack();
    await expect(posts).toHaveCount(0);
    await expect(files).toContainText("Scope file");
    await expect(results).not.toHaveAttribute("inert");
    fail = true;
    await choose("Posts");
    await expect(page.getByText("Search unavailable", { exact: true })).toBeVisible();
    await expect(results).not.toHaveAttribute("inert");
    fail = false;
    await results.getByRole("button", { name: "Try again" }).click();
    await expect(posts).toContainText("Scope article");
    await expect(files).toHaveCount(0);
    await expect(results).toHaveCSS("opacity", "1");
  });
}
