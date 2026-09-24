import { expect, test, type Page } from "@playwright/test";
import { createArticle } from "./support/articles";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

async function monitor(page: Page) {
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    const state = { frames: [] as Keyframe[][], pause: true, tabTransitions: 0 };
    Object.assign(window, { filterMotion: state });
    const loadingFlashes: string[] = [];
    const observer = new MutationObserver(() => {
      document.querySelectorAll('#editor-resource-panel [role="status"]').forEach(node => {
        if (/^Loading (posts|files)/.test(node.textContent || "")) loadingFlashes.push(node.textContent!);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { loadingFlashes });
    document.querySelector(".editor-tabs")?.addEventListener("transitionrun", event => {
      if ((event as TransitionEvent).propertyName === "transform") state.tabTransitions++;
    });
    Element.prototype.animate = function (frames, options) {
      const scopeRegion = this.getAttribute("aria-label") === "Posts" || this.getAttribute("aria-label") === "Files";
      const tracked = this.id === "editor-resource-panel" || scopeRegion || this.hasAttribute("data-result-page");
      if (tracked) state.frames.push(frames as Keyframe[]);
      const animation = original.call(this, frames, options);
      if (tracked && state.pause && (frames as Keyframe[]).at(-1)?.opacity === 0) animation.pause();
      return animation;
    };
  });
}

async function finishTransition(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { filterMotion: { frames: Keyframe[][] } })
    .filterMotion.frames.some(frames => frames.at(-1)?.opacity === 0))).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { filterMotion: { pause: boolean } }).filterMotion.pause = false;
    document.getAnimations().filter(animation => animation.playState === "paused").forEach(animation => animation.play());
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { filterMotion: { frames: Keyframe[][] } })
    .filterMotion.frames.some(frames => Number(frames[0].opacity) === 0 && Number(frames.at(-1)?.opacity) === 1))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  await page.evaluate(() => { const state = (window as unknown as { filterMotion: { frames: Keyframe[][]; pause: boolean } }).filterMotion; state.frames = []; state.pause = true; });
}

for (const route of ["/editor", "/editor?tab=files", "/posts", "/drive"]) {
  test(`${route} transitions between matching and empty searches without replacing pending results`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const csrf = await (await page.request.get(`${E2E_API_URL}/csrf`)).json();
    const login = await page.request.post(`${E2E_API_URL}/login`, { headers: { "X-CSRF-Token": csrf.csrf_token },
      data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } });
    expect(login.ok()).toBeTruthy();
    const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
    const name = `Filter continuity ${Date.now()}`;
    const category = await (await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name } })).json();
    const post = await (await createArticle(page.request, { headers, data: { title: name, content: "Continuity content", status: "published", category_id: category.id } })).json();
    const uploaded = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
      file: { name: "continuity.txt", mimeType: "text/plain", buffer: Buffer.from("Continuity file") }, display_name: name,
    } });
    expect(uploaded.status()).toBe(201);
    const file = await uploaded.json();
    let release = () => {};
    try {
      await page.goto(`${route}${route.includes("?") ? "&" : "?"}q=${encodeURIComponent(name)}`);
      expect(await page.title()).not.toBe("");
      const editor = route.startsWith("/editor");
      const files = route.includes("files") || route === "/drive";
      const region = editor ? page.getByRole("tabpanel") : page.getByRole("region", { name: files ? "Files" : "Posts", exact: true });
      await expect(region.getByText(name, { exact: true }).first()).toBeVisible();
      await monitor(page);
      const input = page.getByRole("textbox", { name: files ? "Search files..." : "Search posts..." });
      const responseGate = new Promise<void>(resolve => { release = resolve; });
      await page.route(editor ? "**/api/admin/search?**" : "**/api/search?**", async request => { await responseGate; await request.continue(); }, { times: 1 });
      await input.fill("nonexistent-filter-continuity");
      await input.press("Enter");
      await expect(region).toHaveAttribute("aria-busy", "true");
      await expect(region.getByText(name, { exact: true }).first()).toBeVisible();
      release();
      await finishTransition(page);
      await expect(region.getByText(files ? "No matching files" : "No matching posts", { exact: true })).toBeVisible();
      await input.fill("another-nonexistent-filter");
      await input.press("Enter");
      await finishTransition(page);
      await input.fill(name);
      await input.press("Enter");
      await finishTransition(page);
      await expect(region.getByText(name, { exact: true }).first()).toBeVisible();
      if (route === "/editor") {
        await page.getByRole("combobox", { name: "Filter articles by category" }).click();
        await page.getByRole("option", { name, exact: true }).click();
        await finishTransition(page);
        await expect(page).toHaveURL(new RegExp(`category=${category.id}`));
        await page.getByRole("tab", { name: /^Files/ }).click();
        await finishTransition(page);
        await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "editor-files-tab");
        await expect(page.locator(".editor-tabs")).toHaveAttribute("data-active-tab", "files");
        expect(await page.evaluate(() => (window as unknown as { filterMotion: { tabTransitions: number } }).filterMotion.tabTransitions)).toBeGreaterThan(0);
        expect(await page.locator(".editor-tabs").evaluate(node => getComputedStyle(node, "::before").transform)).not.toBe("none");
        await page.screenshot({ path: testInfo.outputPath("editor-filters-desktop.png") });
        await page.setViewportSize({ width: 375, height: 850 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.getByRole("tab", { name: /^Posts/ }).click();
        await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "editor-posts-tab");
        expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath("editor-filters-mobile.png") });
      }
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { loadingFlashes: string[] }).loadingFlashes)).toEqual([]);
      await expect(page.locator("nextjs-portal")).toHaveCount(0);
    } finally {
      release();
      await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
      await page.request.delete(`${E2E_API_URL}/admin/files/${file.id}`, { headers });
      await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
    }
  });
}
