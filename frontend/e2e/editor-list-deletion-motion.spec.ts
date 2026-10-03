import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/auth";
import { createArticle } from "./support/articles";
import { E2E_API_URL } from "./support/test-env";

interface CreatedResource { id: number; version?: number }

test("editor post, file, and link deletions fade the removed row and smoothly fill its place", async ({ page }) => {
  const headers = await loginAdmin(page);
  const prefix = `Motion ${crypto.randomUUID().slice(0, 8)}`;
  const created: Record<"posts" | "files" | "links", CreatedResource[]> = { posts: [], files: [], links: [] };
  try {
    for (let index = 0; index < 2; index++) {
      const post = await createArticle(page.request, { headers, data: { title: `${prefix} post ${index}`, content: `Post ${index}` } });
      created.posts.push(await post.json());
      const file = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
        file: { name: `delete-motion-${index}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Editor deletion motion sample document ${index}.`) },
        display_name: `${prefix} file ${index}`, description: "",
      } });
      expect(file.ok(), `file upload: ${file.status()} ${await file.text()}`).toBeTruthy();
      created.files.push(await file.json());
      const link = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
        title: `${prefix} link ${index}`, description: "", url: "", visible: false,
        icon: "link", color: "blue", request_id: crypto.randomUUID(),
      } });
      expect(link.ok()).toBeTruthy();
      created.links.push(await link.json());
    }

    for (const resource of ["posts", "files", "links"] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      const query = resource === "links" ? `link_q=${encodeURIComponent(prefix)}` : `q=${encodeURIComponent(prefix)}`;
      await page.goto(`/editor?tab=${resource}&${query}`);
      const list = page.locator(resource === "links" ? "[data-editor-links-list]" : `[data-editor-list][data-resource="${resource}"]`);
      const rows = list.locator("[data-editor-row-id]");
      await expect(rows).toHaveCount(2);
      const deletedId = await rows.first().getAttribute("data-editor-row-id");
      const survivorId = await rows.nth(1).getAttribute("data-editor-row-id");
      await page.evaluate(() => {
        const tracked = window as typeof window & { deletionMotions?: { id: string; ghost: boolean; duration: number; fromTransform: string; fromOpacity: string; columns: string }[] };
        tracked.deletionMotions = [];
        const original = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const frames = args[0];
          if (this instanceof HTMLElement && this.hasAttribute("data-editor-row-id") && Array.isArray(frames)) {
            tracked.deletionMotions?.push({
              id: this.dataset.editorRowId || "", ghost: this.hasAttribute("data-editor-deletion-ghost"),
              duration: Number((args[1] as KeyframeAnimationOptions).duration),
              fromTransform: String(frames[0]?.transform || ""), fromOpacity: String(frames[0]?.opacity ?? ""),
              columns: getComputedStyle(this).gridTemplateColumns,
            });
          }
          return original.apply(this, args);
        };
      });
      await rows.first().getByRole("button", { name: /More actions for/ }).click();
      await rows.first().getByRole("button", { name: "Delete", exact: true }).click();
      const dialog = page.getByRole("alertdialog", { name: "Confirm Deletion" });
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(rows).toHaveCount(1);
      const motions = await page.evaluate(() => (window as typeof window & { deletionMotions?: { id: string; ghost: boolean; duration: number; fromTransform: string; fromOpacity: string; columns: string }[] }).deletionMotions || []);
      expect(motions, `${resource} deletion animations`).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: deletedId, ghost: true, duration: 180, fromOpacity: "1" }),
        expect.objectContaining({ id: survivorId, ghost: false, duration: 220, fromTransform: expect.stringMatching(/^translateY\(/) }),
      ]));
      await page.setViewportSize({ width: 375, height: 850 });
      await rows.first().scrollIntoViewIfNeeded();
      const mobileColumns = await rows.first().evaluate(node => getComputedStyle(node).gridTemplateColumns);
      await page.evaluate(() => {
        (window as typeof window & { deletionMotions?: unknown[] }).deletionMotions = [];
      });
      await rows.first().getByRole("button", { name: /More actions for/ }).click();
      await rows.first().getByRole("button", { name: "Delete", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(rows).toHaveCount(0);
      const finalMotions = await page.evaluate(() => (window as typeof window & { deletionMotions?: { id: string; ghost: boolean; duration: number; columns: string }[] }).deletionMotions || []);
      expect(finalMotions, `${resource} last-row animation`).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: survivorId, ghost: true, duration: 180, columns: mobileColumns }),
      ]));
    }
  } finally {
    for (const item of created.posts) await page.request.delete(`${E2E_API_URL}/admin/posts/${item.id}`, { headers });
    for (const item of created.files) await page.request.delete(`${E2E_API_URL}/admin/files/${item.id}`, { headers });
    for (const item of created.links) await page.request.delete(`${E2E_API_URL}/admin/links/${item.id}`, { headers, data: { version: item.version } });
  }
});

test("editor list deletion respects reduced motion", async ({ page }) => {
  const headers = await loginAdmin(page);
  const title = `Reduced motion ${crypto.randomUUID().slice(0, 8)}`;
  const response = await createArticle(page.request, { headers, data: { title, content: "Reduced motion article" } });
  const post = await response.json();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/editor?tab=posts&q=${encodeURIComponent(title)}`);
    const row = page.locator(`[data-editor-list] [data-editor-row-id="${post.id}"]`);
    await expect(row).toBeVisible();
    await page.evaluate(() => {
      const tracked = window as typeof window & { rowMotionCount?: number };
      tracked.rowMotionCount = 0;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.hasAttribute("data-editor-row-id")) tracked.rowMotionCount = (tracked.rowMotionCount || 0) + 1;
        return original.apply(this, args);
      };
    });
    await row.getByRole("button", { name: /More actions for/ }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Confirm Deletion" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { rowMotionCount?: number }).rowMotionCount)).toBe(0);
    await expect(page.locator("[data-editor-deletion-ghost]")).toHaveCount(0);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
  }
});
