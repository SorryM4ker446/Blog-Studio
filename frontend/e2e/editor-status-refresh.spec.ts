import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/auth";
import { createArticle } from "./support/articles";
import { E2E_API_URL } from "./support/test-env";

type StatusFrame = { text: string; height: number; linkLeft: number | null; sameLabel: boolean };
type StatusProbe = { statusFrames: () => StatusFrame[]; releaseStatusRead: () => void };

for (const scenario of ["saved draft", "published article", "new draft", "unsaved new draft", "unavailable storage"] as const) {
  test(`refresh shows editor status without skeletons for ${scenario}`, async ({ page }, info) => {
    const headers = await loginAdmin(page);
    const existing = ["saved draft", "published article", "unavailable storage"].includes(scenario);
    const post = existing ? await (await createArticle(page.request, { headers,
      data: { title: "Status refresh", content: "Saved content", status: scenario === "published article" ? "published" : "draft" } })).json() : null;
    const expected = scenario === "unsaved new draft" ? "Editing paused · Browser recovery" : existing ? "All changes saved" : "New draft";
    page.on("dialog", dialog => dialog.accept());
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(post ? `/editor?edit=${post.id}` : "/editor?edit=new");
      const label = page.locator(".editor-save-state > span");
      await expect(label).toHaveText(existing ? "All changes saved" : "New draft");
      if (scenario === "unsaved new draft") {
        await page.locator("#post-title").fill("Browser draft");
        await page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true }).fill("Unsaved content");
        await expect(label).toHaveText("Unsaved changes");
        await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
          const open = indexedDB.open("blog-studio-editor-recovery", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction("copies").objectStore("copies").getAll();
            request.onsuccess = () => { resolve(request.result.some(copy => copy.fields.content === "Unsaved content")); db.close(); };
            request.onerror = () => { reject(request.error); db.close(); };
          };
        }))).toBe(true);
      }
      await page.addInitScript(fail => {
        const frames: StatusFrame[] = [];
        let original: Element | null = null;
        let frame = 0;
        const sample = () => {
          const row = document.querySelector(".editor-save-state");
          const label = row?.querySelector(":scope > span");
          if (row && label) {
            original ??= label;
            frames.push({ text: label.textContent?.trim() ?? "", height: row.getBoundingClientRect().height,
              linkLeft: row.querySelector("a")?.getBoundingClientRect().left ?? null, sameLabel: original === label });
          }
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
        const reads: (() => void)[] = [];
        let blocked = true;
        Object.assign(window, { statusFrames: () => { cancelAnimationFrame(frame); sample(); cancelAnimationFrame(frame); return frames; },
          releaseStatusRead: () => { blocked = false; reads.forEach(release => release()); } });
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function(...args) {
          if (fail && args[0] === "blog-studio-editor-recovery") throw new DOMException("Storage unavailable", "SecurityError");
          const request = open.apply(this, args);
          if (args[0] === "blog-studio-editor-recovery") request.addEventListener("success", event => {
            if (!blocked) return;
            event.stopImmediatePropagation();
            reads.push(() => request.dispatchEvent(new Event("success")));
          }, { capture: true, once: true });
          return request;
        };
      }, scenario === "unavailable storage");
      await page.reload({ waitUntil: "domcontentloaded" });
      if (scenario !== "unavailable storage") {
        await expect(page.locator(".editor-save-state")).toHaveAttribute("aria-busy", "true");
        await expect(label).toHaveText(existing ? "All changes saved" : "New draft");
        await expect(label).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.evaluate(() => (window as unknown as StatusProbe).releaseStatusRead());
      } else {
        await expect(page.getByText("Browser recovery is full or unavailable. Save to the server or copy your text.", { exact: true })).toBeVisible();
      }
      await expect(label).toHaveText(expected);
      await expect(page.locator(".editor-save-state")).toHaveAttribute("aria-busy", "false");
      const frames = await page.evaluate(() => (window as unknown as StatusProbe).statusFrames());
      await info.attach("status-refresh-frames", { body: JSON.stringify(frames), contentType: "application/json" });
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every(frame => Boolean(frame.text))).toBe(true);
      expect(new Set(frames.map(frame => frame.text))).toEqual(new Set(scenario === "unsaved new draft" ? ["New draft", expected] : [expected]));
      const firstReady = frames.findIndex(frame => frame.text === expected);
      expect(firstReady).toBeGreaterThanOrEqual(0);
      expect(frames.slice(firstReady).every(frame => frame.text === expected)).toBe(true);
      expect(frames.every(frame => frame.sameLabel)).toBe(true);
      expect(Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height))).toBeLessThan(1);
      if (scenario === "published article") {
        await expect(page.getByRole("link", { name: "View article" })).toBeVisible();
        const positions = frames.map(frame => frame.linkLeft!);
        expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
      }
      if (existing) {
        await page.locator("#post-title").fill("Changed title");
        await expect(label).toHaveText("Unsaved changes");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(label).toHaveText("All changes saved");
      }
      expect(errors).toEqual([]);
    } finally {
      if (post) await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    }
  });
}
