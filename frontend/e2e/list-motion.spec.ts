import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";
import { createArticle } from "./support/articles";

const cases = [
  { route: "/posts", input: "Search posts...", region: "Posts", kind: "posts", sideArrows: false },
  { route: "/drive", input: "Search files...", region: "Files", kind: "files", sideArrows: false },
  { route: "/search?scope=files", input: "Search posts and files", region: "File results", kind: "files", sideArrows: true },
  { route: "/editor", input: "Search posts...", region: "Posts", kind: "posts", sideArrows: false },
  { route: "/editor?tab=files", input: "Search files...", region: "Files", kind: "files", sideArrows: false },
];

for (const scenario of cases) {
  test(`${scenario.route} keeps pagination stable and animates result changes`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    const editor = scenario.route.startsWith("/editor");
    const checksArticleReturn = scenario.route === "/posts" || scenario.route === "/editor";
    let headers: Record<string, string> = {};
    let returnPost: { id: number } | undefined;
    if (editor || checksArticleReturn) {
      const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
      const login = await page.request.post(`${E2E_API_URL}/login`, {
        headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
        data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
      });
      expect(login.ok()).toBeTruthy();
      headers = { "X-CSRF-Token": (await (await page.request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token };
    }
    if (checksArticleReturn) returnPost = await (await createArticle(page.request, { headers, data: {
      title: "Motion article 11", content: "Real article used to verify list return navigation.", status: "published", category_id: 0,
    } })).json();
    try {
    await page.goto(scenario.route);
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      const records: Keyframe[][] = [];
      Object.assign(window, { listMotionRecords: records, pauseListExit: false });
      Element.prototype.animate = function (frames, options) {
        if (this.hasAttribute("data-result-page")) records.push(frames as Keyframe[]);
        const animation = original.call(this, frames, options);
        if (this.hasAttribute("data-result-page") && (frames as Keyframe[]).at(-1)?.opacity === 0
          && (window as unknown as { pauseListExit: boolean }).pauseListExit) animation.pause();
        return animation;
      };
    });
    let release!: () => void;
    let gate: Promise<void> | null = null;
    await page.route(editor ? "**/api/admin/search?**" : "**/api/search?**", async route => {
      const url = new URL(route.request().url());
      const number = Number(url.searchParams.get("page"));
      expect(url.searchParams.get("scope")).toBe(scenario.kind);
      if (gate) await gate;
      const date = "2026-09-12T00:00:00Z";
      const rows = Array.from({ length: number === 1 ? 10 : 1 }, (_, index) => {
        const id = (number - 1) * 10 + index + 1;
        return scenario.kind === "posts" ? { id: number === 2 && returnPost ? returnPost.id : id, title: `Motion article ${id}`, summary: "", slug: `motion-${id}`,
          category_id: null, category: null, status: "published", published_at: date, last_edited_at: null, created_at: date, updated_at: date }
          : { id, orig_name: `motion-${id}.txt`, display_name: `Motion file ${id}`, description: "", mime_type: "text/plain", size: 32, created_at: date, is_system: false };
      });
      await route.fulfill({ json: { posts: scenario.kind === "posts" ? rows : [], files: scenario.kind === "files" ? rows : [],
        posts_total: scenario.kind === "posts" ? 11 : 0, files_total: scenario.kind === "files" ? 11 : 0,
        total: 11, page: number, limit: 10 } });
    });
    const input = page.getByRole("textbox", { name: scenario.input });
    await input.fill("list-motion");
    await input.press("Enter");
    const region = editor ? page.getByRole("tabpanel") : page.getByRole("region", { name: scenario.region, exact: true });
    const rows = region.locator(scenario.kind === "posts" ? (editor ? ".editor-post-card" : 'a[href^="/posts/"]') : "[data-file-id]");
    const next = region.getByRole("button", { name: "Next page" });
    const previous = region.getByRole("button", { name: "Previous page" });
    await expect(rows).toHaveCount(10);
    await expect(next).toBeEnabled();
    const content = region.locator("[data-result-page]");
    // Initial search can change the height of an existing server-rendered list.
    await expect.poll(() => content.evaluate(node => node.parentElement!.getAnimations({ subtree: true })
      .filter(animation => animation.playState === "running").length)).toBe(0);
    const initialBox = await content.boundingBox();
    const initialFrameHeight = await content.evaluate(node => node.parentElement!.getBoundingClientRect().height);
    const arrow = await next.boundingBox();
    const leftArrow = await previous.boundingBox();
    if (scenario.sideArrows) {
      expect(arrow!.x).toBeGreaterThan(initialBox!.x + initialBox!.width);
      expect(leftArrow!.x + leftArrow!.width).toBeLessThan(initialBox!.x);
    } else {
      const pageNumber = await region.getByRole("button", { name: "Page 1, current page" }).boundingBox();
      expect(arrow!.y).toBeGreaterThan(initialBox!.y + initialBox!.height);
      expect(leftArrow!.y).toBeGreaterThan(initialBox!.y + initialBox!.height);
      expect(arrow!.y).toBeCloseTo(pageNumber!.y, 0);
      expect(leftArrow!.y).toBeCloseTo(pageNumber!.y, 0);
    }
    await next.evaluate(node => node.setAttribute("data-original-control", "true"));
    await page.evaluate(() => Object.assign(window, { pauseListExit: true }));
    gate = new Promise(resolve => { release = resolve; });
    await next.click();
    await expect(next).toBeDisabled();
    await expect(next).toHaveCSS("opacity", "1");
    await expect(next).toHaveAttribute("data-original-control", "true");
    await expect(rows).toHaveCount(10);
    await expect(region.getByRole("button", { name: "Page 1, current page" })).toBeVisible();
    gate = null; release();
    await expect.poll(() => content.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect(rows).toHaveCount(10);
    await expect(next).toBeDisabled();
    await content.evaluate(node => {
      Object.assign(window, { pauseListExit: false });
      node.getAnimations().filter(animation => animation.playState === "paused").forEach(animation => animation.finish());
    });
    await expect(rows).toHaveCount(1);
    await expect(region.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
    if (editor) {
      expect(await content.evaluate(node => node.parentElement!.getBoundingClientRect().height)).toBeCloseTo(initialFrameHeight, 0);
    }
    const records = () => page.evaluate(() => (window as unknown as { listMotionRecords: Keyframe[][] }).listMotionRecords);
    expect((await records()).at(-1)?.[0].transform).toBe("translateX(14px)");
    expect((await records()).at(-1)?.[0].opacity).toBe(0);
    expect((await records()).some(frames => frames.at(-1)?.opacity === 0 && frames.at(-1)?.transform === "translateX(-8px)")).toBe(true);
    await previous.click();
    await expect(rows).toHaveCount(10);
    expect((await records()).at(-1)?.[0].transform).toBe("translateX(-14px)");
    await page.goBack();
    await expect(rows).toHaveCount(1);
    await page.goForward();
    await expect(rows).toHaveCount(10);
    await expect(input).toHaveValue("list-motion");
    if (scenario.route === "/posts" || scenario.route === "/editor") {
      await next.click();
      await expect(rows).toHaveCount(1);
      if (editor) await rows.first().getByRole("button", { name: "Open Motion article 11", exact: true }).click();
      else await rows.first().click();
      await expect(page).toHaveURL(url => url.pathname === `/posts/${returnPost!.id}`);
      await expect(page.getByRole("heading", { name: "Motion article 11", exact: true })).toBeVisible();
      await expect(page.locator("aside.sidebar").getByRole("link", { name: editor ? "Content Editor" : "All Posts", exact: true })).toHaveAttribute("aria-current", "page");
      const countBeforeReturn = (await records()).length;
      gate = new Promise(resolve => { release = resolve; });
      await page.goBack();
      await expect(region.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
      await expect(rows).toHaveCount(1);
      await expect(region.getByRole("button", { name: "Page 1, current page" })).toHaveCount(0);
      gate = null; release();
      await expect(previous).toBeEnabled();
      expect((await records()).length).toBe(countBeforeReturn);
      if (editor) expect(await content.evaluate(node => node.parentElement!.getBoundingClientRect().height)).toBeCloseTo(initialFrameHeight, 0);
      await expect(content).toHaveCSS("opacity", "1");
      await previous.click();
      await expect(rows).toHaveCount(10);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const before = (await records()).length;
    await next.click();
    await expect(rows).toHaveCount(1);
    expect((await records()).length).toBe(before);
    if (editor) {
      await page.reload();
      await expect(region.getByRole("button", { name: "Page 2, current page" })).toBeVisible();
      await expect(rows).toHaveCount(1);
      expect(await content.evaluate(node => node.parentElement!.getBoundingClientRect().height)).toBeCloseTo(initialFrameHeight, 0);
    }
    await page.setViewportSize({ width: 760, height: 1000 });
    const narrowContent = await content.boundingBox();
    if (editor) {
      await expect.poll(() => content.evaluate(node => Math.abs(node.parentElement!.getBoundingClientRect().height - node.getBoundingClientRect().height))).toBeLessThan(1);
    }
    expect((await previous.boundingBox())!.y).toBeGreaterThan(narrowContent!.y + narrowContent!.height);
    expect((await next.boundingBox())!.y).toBeGreaterThan(narrowContent!.y + narrowContent!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      if (returnPost) await page.request.delete(`${E2E_API_URL}/admin/posts/${returnPost.id}`, { headers });
    }
  });
}
