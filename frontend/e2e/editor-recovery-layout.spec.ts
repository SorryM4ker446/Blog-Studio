import { expect, test, type Page } from "@playwright/test";
import { loginAdmin } from "./support/auth";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

async function waitForCopy(page: Page, content: string) {
  await expect.poll(() => page.evaluate(value => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open("blog-studio-editor-recovery", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("copies").objectStore("copies").getAll();
      request.onsuccess = () => { resolve(request.result.some(copy => copy.fields.content === value)); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }), content)).toBe(true);
}

async function sampleReload(page: Page, blockRecovery = true) {
  await page.addInitScript(block => {
    const frames: { scroll: number; height: number; header: number; surface: number; status: string; recoveryOpacity: number; sameHeading: boolean; title: string; date: string; count: string }[] = [];
    let originalHeading: Element | null = null;
    let frame = 0;
    const visibleText = (element: Element | null) => {
      if (!element) return "";
      const generated = getComputedStyle(element, "::before").content;
      if (generated.startsWith('"')) return JSON.parse(generated) as string;
      return element.textContent?.trim() ?? "";
    };
    const sample = () => {
      const scroll = document.querySelector(".content-scroll");
      const header = document.querySelector(".editor-form-header");
      const surface = document.querySelector(".editor-form-surface");
      const heading = document.querySelector('[data-recovery-shell] h2');
      originalHeading ??= heading;
      let recoveryOpacity = heading ? 1 : 0;
      for (let node = heading; node; node = node.parentElement) recoveryOpacity *= Number(getComputedStyle(node).opacity);
      if (scroll && header && surface) frames.push({ scroll: scroll.scrollTop, height: scroll.scrollHeight,
        header: header.getBoundingClientRect().top + scroll.scrollTop,
        surface: surface.getBoundingClientRect().top + scroll.scrollTop,
        status: visibleText(document.querySelector(".editor-save-state > span")),
        title: visibleText(document.querySelector('[data-recovery-copy="0"] [data-recovery-title]')),
        date: visibleText(document.querySelector('[data-recovery-copy="0"] [data-recovery-date]')),
        count: visibleText(document.querySelector('[data-recovery-count]')),
        recoveryOpacity, sameHeading: originalHeading === heading && heading !== null });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    Object.assign(window, { finishLayoutFrames: () => { cancelAnimationFrame(frame); return frames; } });
    if (!block) return;
    let blocked = true;
    const reads: (() => void)[] = [];
    Object.assign(window, { releaseRecoveryRead: () => {
      blocked = false;
      reads.forEach(release => release());
    } });
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(...args) {
      const request = open.apply(this, args);
      if (args[0] === "blog-studio-editor-recovery") request.addEventListener("success", event => {
        if (!blocked) return;
        event.stopImmediatePropagation();
        const probe = window as unknown as { recoveryReadStarted?: number };
        probe.recoveryReadStarted ??= performance.now();
        reads.push(() => request.dispatchEvent(new Event("success")));
      }, { capture: true, once: true });
      return request;
    };
  }, blockRecovery);
}

for (const viewport of [{ width: 1500, height: 1000 }, { width: 375, height: 850 }]) {
  test(`recovery reload keeps its panel and status stable while resetting scroll at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const headers = await loginAdmin(page);
    const post = await (await page.request.post(`${E2E_API_URL}/admin/posts`, { headers,
      data: { title: 'Recovery "layout" <&> \\ sample', content: "Saved content" } })).json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("dialog", dialog => dialog.accept());
    try {
      await page.goto(`/editor?edit=${post.id}`);
      await page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true }).fill("Browser copy");
      await waitForCopy(page, "Browser copy");
      await page.reload();
      await expect(page.getByRole("region", { name: "Browser recovery" })).toBeVisible();
      await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "false");
      const date = await page.locator('[data-recovery-copy="0"] [data-recovery-date]').textContent();
      for (const position of [80, 460]) {
        await page.locator(".content-scroll").evaluate((node, top) => { node.scrollTop = top; }, position);
        await expect.poll(() => page.evaluate(() => history.state?.blogNavigation?.scroll)).toBe(position);
        if (position === 80) await sampleReload(page);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-recovery-checking", "true");
        await expect(page.locator(".content-scroll")).toHaveJSProperty("scrollTop", 0);
        await expect(page.locator('[data-recovery-shell] h2')).toBeVisible();
        await expect(page.locator('[data-recovery-copy="0"] [data-recovery-title]')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(page.locator(".editor-save-state > span")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(page.locator('[data-recovery-copy="0"] button')).toBeDisabled();
        await expect(page.locator("#post-title")).toHaveValue(post.title);
        if (position === 80) await page.screenshot({ path: info.outputPath("recovery-refresh-reading.png") });
        await expect.poll(() => page.evaluate(() => performance.now() -
          (window as unknown as { recoveryReadStarted: number }).recoveryReadStarted),
        { intervals: [100] }).toBeGreaterThan(2100);
        await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "true");
        await page.evaluate(() => (window as unknown as { releaseRecoveryRead: () => void }).releaseRecoveryRead());
        await expect(page.getByRole("region", { name: "Browser recovery" })).toBeVisible();
        await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "false");
        await expect(page.locator(".content-scroll")).toHaveJSProperty("scrollTop", 0);
        const frames = await page.evaluate(() => (window as unknown as { finishLayoutFrames: () => { scroll: number; height: number; header: number; surface: number; status: string; recoveryOpacity: number; sameHeading: boolean; title: string; date: string; count: string }[] }).finishLayoutFrames());
        await info.attach(`reload-${position}-frames`, { body: JSON.stringify(frames), contentType: "application/json" });
        expect(frames.length).toBeGreaterThan(5);
        for (const key of ["scroll", "height", "header", "surface"] as const)
          expect(Math.max(...frames.map(frame => frame[key])) - Math.min(...frames.map(frame => frame[key]))).toBeLessThan(2);
        expect(frames.every(frame => frame.sameHeading && frame.recoveryOpacity === 1)).toBe(true);
        expect(new Set(frames.map(frame => frame.status))).toEqual(new Set(["Editing paused · Browser recovery"]));
        expect(frames.every(frame => frame.title === post.title && frame.date === date && frame.count === "1 copy")).toBe(true);
        const firstReady = frames.findIndex(frame => Boolean(frame.status));
        expect(frames.slice(firstReady).every(frame => frame.status === "Editing paused · Browser recovery")).toBe(true);
      }
      await page.screenshot({ path: info.outputPath("recovery-reloaded.png") });
      expect(await page.title()).toBe("Blog Studio");
      await expect(page).toHaveURL(`${E2E_APP_URL}/editor?edit=${post.id}&tab=posts`);
      // Presentation labels must not become recovery choices after the real copy disappears.
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("blog-studio-editor-recovery", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("copies", "readwrite");
          tx.objectStore("copies").clear();
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-recovery-checking", "true");
      await expect(page.locator('[data-recovery-copy="0"] button')).toBeDisabled();
      await page.evaluate(() => (window as unknown as { releaseRecoveryRead: () => void }).releaseRecoveryRead());
      await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "false");
      await expect(page.getByRole("region", { name: "Browser recovery" })).toHaveCount(0);
      await expect(page.locator(".editor-save-state > span")).toHaveText("All changes saved");
      await expect(page.locator(".editor-save-button")).toBeEnabled();
      await expect(page.locator(".custom-editor-wrapper textarea")).toHaveValue("Saved content");
      expect(errors).toEqual([]);
    } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`Restore opens conflict review smoothly with ${reducedMotion} motion`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: "dark", url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.emulateMedia({ reducedMotion });
    const headers = await loginAdmin(page);
    const post = await (await page.request.post(`${E2E_API_URL}/admin/posts`, { headers,
      data: { title: "Conflict transition", content: "Original content" } })).json();
    page.on("dialog", dialog => dialog.accept());
    let writes = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.goto(`/editor?edit=${post.id}`);
      const content = page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true });
      await content.fill("My browser copy");
      await waitForCopy(page, "My browser copy");
      expect((await page.request.put(`${E2E_API_URL}/admin/posts/${post.id}`, { headers,
        data: { title: post.title, content: "Latest saved version", version: post.version } })).ok()).toBe(true);
      await page.reload();
      const recovery = page.getByRole("region", { name: "Browser recovery" });
      await expect(recovery).toBeVisible();
      await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "false");
      page.on("request", request => {
        if (/\/admin\/posts(?:\/|$)/.test(new URL(request.url()).pathname) && ["POST", "PUT"].includes(request.method())) writes++;
      });
      await page.evaluate(() => {
        const frames: { height: number; surface: number }[] = [];
        let frame = 0;
        const sample = () => {
          const slot = document.querySelector('[data-editor-notice="conflict"]');
          const surface = document.querySelector(".editor-form-surface");
          const scroll = document.querySelector(".content-scroll");
          if (slot && surface && scroll) frames.push({ height: slot.getBoundingClientRect().height,
            surface: surface.getBoundingClientRect().top + scroll.scrollTop });
          frame = requestAnimationFrame(sample);
        };
        sample();
        Object.assign(window, { finishConflictFrames: () => { cancelAnimationFrame(frame); return frames; } });
      });
      await recovery.getByRole("button", { name: "Restore copy 1" }).click();
      const conflict = page.getByRole("region", { name: "Article version conflict" });
      await expect(conflict).toBeVisible();
      await expect(recovery).toHaveCount(0);
      await expect.poll(() => page.locator(".editor-detail-frame").evaluate(node =>
        node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
      await expect(content).toHaveValue("My browser copy");
      await expect(conflict.getByLabel("Latest saved content")).toHaveValue("Latest saved version");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      const frames = await page.evaluate(() => (window as unknown as { finishConflictFrames: () => { height: number; surface: number }[] }).finishConflictFrames());
      await info.attach("restore-conflict-frames", { body: JSON.stringify(frames), contentType: "application/json" });
      if (reducedMotion === "no-preference") {
        expect(new Set(frames.map(frame => Math.round(frame.height))).size).toBeGreaterThan(4);
        expect(Math.max(...frames.slice(1).map((frame, index) => Math.abs(frame.surface - frames[index].surface)))).toBeLessThan(120);
      }
      await page.screenshot({ path: info.outputPath("conflict-restored.png") });
      await sampleReload(page, false);
      await page.reload();
      await expect(page.getByRole("region", { name: "Browser recovery" })).toBeVisible();
      await expect(page.locator(".editor-detail-frame")).toHaveAttribute("data-scroll-pending", "false");
      await expect(content).toHaveValue("Latest saved version");
      const reloadFrames = await page.evaluate(() => (window as unknown as { finishLayoutFrames: () => { scroll: number; height: number; header: number; surface: number; status: string; recoveryOpacity: number; sameHeading: boolean }[] }).finishLayoutFrames());
      await info.attach("conflict-reload-frames", { body: JSON.stringify(reloadFrames), contentType: "application/json" });
      if (reducedMotion === "no-preference") {
        expect(Math.max(...reloadFrames.slice(1).map((frame, index) => Math.abs(frame.surface - reloadFrames[index].surface)))).toBeLessThan(120);
        expect(new Set(reloadFrames.map(frame => Math.round(frame.surface))).size).toBeGreaterThan(4);
        expect(new Set(reloadFrames.map(frame => Math.round(frame.header))).size).toBeGreaterThan(4);
        expect(reloadFrames.some(frame => frame.recoveryOpacity > .1 && frame.recoveryOpacity < .9)).toBe(true);
      }
      expect(reloadFrames.every(frame => frame.scroll === 0)).toBe(true);
      expect(reloadFrames.at(-1)?.recoveryOpacity).toBe(1);
      expect(new Set(reloadFrames.map(frame => frame.status))).toEqual(new Set(["All changes saved", "Editing paused · Browser recovery"]));
      expect(writes).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
  });
}
