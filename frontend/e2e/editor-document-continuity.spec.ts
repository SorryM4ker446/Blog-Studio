import { expect, test } from "@playwright/test";
import { createArticle } from "./support/articles";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test.use({ viewport: { width: 1600, height: 1100 } });

for (const locale of ["en-US", "zh-CN"]) test.describe(locale, () => {
test.use({ locale });

for (const flow of ["refresh", "return"]) test(`editor ${flow} preserves its document presentation`, async ({ page }, testInfo) => {
  const csrf = await (await page.request.get(`${E2E_API_URL}/csrf`)).json();
  const login = await page.request.post(`${E2E_API_URL}/login`, { headers: { "X-CSRF-Token": csrf.csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS } });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const post = await (await createArticle(page.request, { headers, data: { title: "Document continuity", content: "Document body continuity", status: "draft" } })).json();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(`/editor?edit=${post.id}`);
    await expect(page.locator("#post-title")).toHaveValue(post.title);
    await expect(page.locator(".editor-save-button")).toBeEnabled();
    await expect(page.locator(".button-type-header")).toHaveAttribute("title", locale === "zh-CN" ? "标题" : "Header");
    if (flow === "refresh") {
      await page.addInitScript(() => {
        const frames: { opacity: number; categoryOpacity: number; width: number; top: number; title: string; attached: boolean; body: string }[] = [];
        let original: Element | null = null;
        let frame = 0;
        const sample = () => {
          const title = document.querySelector<HTMLInputElement>("#post-title");
          const form = document.querySelector(".editor-detail-frame");
          if (title && form) {
            original ??= title;
            let opacity = 1;
            for (let node: Element | null = title; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
            const rect = form.getBoundingClientRect();
            const categoryButton = document.querySelector('[aria-label="Create category"]');
            frames.push({ opacity, categoryOpacity: categoryButton ? Number(getComputedStyle(categoryButton).opacity) : 0, width: rect.width, top: rect.top + (document.querySelector(".content-scroll")?.scrollTop ?? 0),
              title: title.value, attached: original === title, body: document.querySelector(".custom-html-style")?.textContent ?? "" });
          }
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
        Object.assign(window, { refreshFrames: () => { cancelAnimationFrame(frame); return frames; } });
      });
      let release = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/_next/static/**/*.js", async route => { await gate; await route.continue(); });
      try {
        await page.reload({ waitUntil: "commit" });
        await expect(page.locator("#post-title")).toHaveValue(post.title);
        await expect(page.locator(".custom-editor-wrapper textarea")).toHaveValue(post.content);
        await expect(page.locator(".custom-html-style")).toContainText(post.content);
        await expect(page.locator(".button-type-header")).toHaveAttribute("title", "Header");
        await expect(page.getByRole("button", { name: "Create category", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Create category", exact: true })).toHaveCSS("opacity", "1");
        expect(await page.locator("form").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
      } finally { release(); }
      await expect(page.locator(".editor-save-button")).toBeEnabled();
      await expect(page.getByRole("button", { name: "Create category", exact: true })).toBeEnabled();
      await expect(page.locator(".button-type-header")).toHaveAttribute("title", locale === "zh-CN" ? "标题" : "Header");
      await expect(page.locator(".custom-editor-wrapper textarea")).toHaveValue(post.content);
      await expect(page.getByText("Loading article…", { exact: true })).toHaveCount(0);
      const frames = await page.evaluate(() => (window as unknown as { refreshFrames: () => { opacity: number; categoryOpacity: number; width: number; top: number; title: string; attached: boolean; body: string }[] }).refreshFrames());
      await testInfo.attach("refresh-frames", { body: JSON.stringify(frames), contentType: "application/json" });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(frame => frame.attached && frame.opacity === 1 && frame.title === post.title && frame.body.includes(post.content))).toBe(true);
      expect(frames.every(frame => frame.categoryOpacity === 1)).toBe(true);
      expect(Math.max(...frames.map(frame => frame.width)) - Math.min(...frames.map(frame => frame.width))).toBeLessThan(1);
      expect(Math.max(...frames.map(frame => frame.top)) - Math.min(...frames.map(frame => frame.top))).toBeLessThan(1);
      await page.screenshot({ path: testInfo.outputPath("editor-refreshed.png") });
    } else {
      await page.evaluate(() => {
        const animations: string[] = [];
        document.addEventListener("animationstart", event => { animations.push((event as AnimationEvent).animationName); });
        Object.assign(window, { editorEntrances: animations });
      });
      await page.getByRole("button", { name: "Back to content list" }).click();
      await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { editorEntrances: string[] }).editorEntrances.length)).toBe(1);
      await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    }
    expect(errors).toEqual([]);
  } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
});
});
