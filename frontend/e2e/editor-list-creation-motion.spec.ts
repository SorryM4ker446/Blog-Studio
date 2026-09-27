import { expect, test, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/accessibility";
import { createArticle } from "./support/articles";
import { E2E_API_URL } from "./support/test-env";

interface RowMotion { id: string; duration: number; opacity: string; transform: string; background: string }
interface RowGlow { id: string; active: boolean; image: string; animation: string }

async function trackRowMotions(page: Page) {
  await page.evaluate(() => {
    const tracked = window as typeof window & { rowMotions?: RowMotion[]; rowGlows?: RowGlow[] };
    tracked.rowMotions = [];
    tracked.rowGlows = [];
    new MutationObserver(records => {
      for (const record of records) {
        if (!(record.target instanceof HTMLElement)) continue;
        const row = record.target;
        const glow = getComputedStyle(row, "::before");
        tracked.rowGlows?.push({
          id: row.dataset.editorRowId || "",
          active: row.hasAttribute("data-editor-entering"),
          image: glow.backgroundImage,
          animation: glow.animationName,
        });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-editor-entering"] });
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const frames = args[0];
      if (this instanceof HTMLElement && this.hasAttribute("data-editor-row-id") && Array.isArray(frames)) {
        tracked.rowMotions?.push({
          id: this.dataset.editorRowId || "",
          duration: Number((args[1] as KeyframeAnimationOptions).duration),
          opacity: String(frames[0]?.opacity ?? ""),
          transform: String(frames[0]?.transform || ""),
          background: String(frames[0]?.backgroundColor || ""),
        });
      }
      return original.apply(this, args);
    };
  });
}

async function rowMotions(page: Page): Promise<RowMotion[]> {
  return page.evaluate(() => (window as typeof window & { rowMotions?: RowMotion[] }).rowMotions || []);
}

async function expectEntranceGlow(page: Page, id: string) {
  await expect.poll(() => page.evaluate(rowId => {
    const events = (window as typeof window & { rowGlows?: RowGlow[] }).rowGlows || [];
    return events.some(event => event.id === rowId && event.active && event.image.includes("radial-gradient") && event.animation !== "none");
  }, id)).toBe(true);
  await expect.poll(() => page.evaluate(rowId => {
    const events = (window as typeof window & { rowGlows?: RowGlow[] }).rowGlows || [];
    return events.some(event => event.id === rowId && !event.active);
  }, id)).toBe(true);
  await expect(page.locator(`[data-editor-row-id="${id}"]`)).not.toHaveAttribute("data-editor-entering");
}

test("a new post enters the list after returning from its saved editor", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const headers = await loginAdmin(page);
  const prefix = `New row ${crypto.randomUUID().slice(0, 8)}`;
  const existing = await createArticle(page.request, { headers, data: { title: `${prefix} existing`, content: "Existing article" } });
  const existingPost = await existing.json();
  let createdId: string | null = null;
  try {
    await page.goto(`/editor?tab=posts&q=${encodeURIComponent(prefix)}`);
    await expect(page.locator(`[data-editor-row-id="${existingPost.id}"]`)).toBeVisible();
    await trackRowMotions(page);
    await page.getByRole("button", { name: "New Post" }).click();
    expect(await rowMotions(page)).toEqual([]);
    await page.getByRole("textbox", { name: "Post title" }).fill(`${prefix} created`);
    await page.locator(".custom-editor-wrapper textarea").fill("New article content");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/edit=\d+/);
    createdId = new URL(page.url()).searchParams.get("edit");
    await expect(page.getByText("Saved successfully!", { exact: true })).toBeVisible();
    expect(await rowMotions(page)).toEqual([]);
    await page.evaluate(id => {
      const tracked = window as typeof window & { postEntryFrames?: { elapsed: number; opacity: number }[] };
      tracked.postEntryFrames = [];
      const started = performance.now();
      const sample = () => {
        const row = document.querySelector<HTMLElement>(`[data-editor-list][data-resource="posts"] [data-editor-row-id="${id}"]`);
        const view = row?.closest<HTMLElement>("[data-editor-view]");
        if (row && view) tracked.postEntryFrames?.push({
          elapsed: performance.now() - started,
          opacity: Number(getComputedStyle(row).opacity) * Number(getComputedStyle(view).opacity),
        });
        if (performance.now() - started < 600) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, createdId);
    await page.getByRole("button", { name: "Back to content list" }).click();
    await expect(page.locator(`[data-editor-list][data-resource="posts"] [data-editor-row-id="${createdId}"]`)).toBeVisible();
    await expect.poll(async () => (await rowMotions(page)).some(motion => motion.id === createdId && motion.opacity === "0")).toBe(true);
    expect(await rowMotions(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdId, duration: 180, opacity: "0", transform: "" }),
      expect.objectContaining({ id: String(existingPost.id), duration: 220, transform: expect.stringMatching(/^translateY\(/) }),
    ]));
    expect((await rowMotions(page)).filter(motion => motion.id === createdId).every(motion => motion.background === "")).toBe(true);
    await expectEntranceGlow(page, createdId!);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { postEntryFrames?: { elapsed: number }[] }).postEntryFrames?.at(-1)?.elapsed || 0)).toBeGreaterThan(500);
    const frames = await page.evaluate(() => (window as typeof window & { postEntryFrames?: { elapsed: number; opacity: number }[] }).postEntryFrames || []);
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.at(-1)!.opacity).toBeGreaterThan(0.99);
    for (let index = 1; index < frames.length; index++) {
      expect(frames[index].opacity, `new post opacity dropped at frame ${index}`).toBeGreaterThanOrEqual(frames[index - 1].opacity - 0.08);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-new-post-desktop.png") });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect(page.locator(`[data-editor-list][data-resource="posts"] [data-editor-row-id="${createdId}"]`)).toBeVisible();
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-new-post-mobile.png") });
    expect(browserErrors).toEqual([]);
  } finally {
    if (createdId) await page.request.delete(`${E2E_API_URL}/admin/posts/${createdId}`, { headers });
    await page.request.delete(`${E2E_API_URL}/admin/posts/${existingPost.id}`, { headers });
  }
});

test("an uploaded file enters after its dialog closes while the earlier row moves down", async ({ page }) => {
  const headers = await loginAdmin(page);
  const prefix = `New file ${crypto.randomUUID().slice(0, 8)}`;
  const existing = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
    file: { name: "existing.txt", mimeType: "text/plain", buffer: Buffer.from("Existing file") },
    display_name: `${prefix} old`, description: "",
  } });
  expect(existing.ok()).toBeTruthy();
  const existingFile = await existing.json();
  let createdId: number | null = null;
  try {
    await page.goto(`/editor?tab=files&q=${encodeURIComponent(prefix)}`);
    const earlierRow = page.locator(`[data-editor-list][data-resource="files"] [data-editor-row-id="${existingFile.id}"]`);
    await expect(earlierRow).toBeVisible();
    const earlierTop = (await earlierRow.boundingBox())!.y;
    await trackRowMotions(page);
    await page.evaluate(existingId => {
      const tracked = window as typeof window & { fileEntry?: { appearedWithDialog: boolean | null; positions: { elapsed: number; top: number }[] } };
      tracked.fileEntry = { appearedWithDialog: null, positions: [] };
      const observer = new MutationObserver(() => {
        if (tracked.fileEntry?.appearedWithDialog !== null) return;
        const rows = document.querySelectorAll('[data-editor-list][data-resource="files"] [data-editor-row-id]');
        if (rows.length < 2) return;
        tracked.fileEntry!.appearedWithDialog = Boolean(document.querySelector("[data-modal-overlay]"));
        const started = performance.now();
        const sample = () => {
          const row = document.querySelector<HTMLElement>(`[data-editor-list][data-resource="files"] [data-editor-row-id="${existingId}"]`);
          if (row) tracked.fileEntry?.positions.push({ elapsed: performance.now() - started, top: row.getBoundingClientRect().top });
          if (performance.now() - started < 300) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, existingFile.id);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    expect(await rowMotions(page)).toEqual([]);
    const dialog = page.getByRole("dialog", { name: "Upload a file" });
    await dialog.locator('input[type="file"]').setInputFiles({ name: "new.txt", mimeType: "text/plain", buffer: Buffer.from("New file") });
    await dialog.getByRole("textbox", { name: /Display name/ }).fill(`${prefix} new`);
    const responsePromise = page.waitForResponse(response => response.url() === `${E2E_API_URL}/admin/files` && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    createdId = (await response.json()).id;
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-editor-list][data-resource="files"] [data-editor-row-id="${createdId}"]`)).toBeVisible();
    await expect.poll(async () => (await rowMotions(page)).some(motion => motion.id === String(createdId) && motion.opacity === "0")).toBe(true);
    expect(await rowMotions(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: String(createdId), duration: 180, opacity: "0", transform: "translateY(6px)" }),
      expect.objectContaining({ id: String(existingFile.id), duration: 220, transform: expect.stringMatching(/^translateY\(/) }),
    ]));
    expect((await rowMotions(page)).filter(motion => motion.id === String(createdId)).every(motion => motion.background === "")).toBe(true);
    await expectEntranceGlow(page, String(createdId));
    await expect.poll(() => page.evaluate(() => (window as typeof window & { fileEntry?: { positions: { elapsed: number }[] } }).fileEntry?.positions.at(-1)?.elapsed || 0)).toBeGreaterThan(250);
    const entry = await page.evaluate(() => (window as typeof window & { fileEntry?: { appearedWithDialog: boolean | null; positions: { elapsed: number; top: number }[] } }).fileEntry!);
    expect(entry.appearedWithDialog).toBe(false);
    expect(entry.positions.length).toBeGreaterThan(5);
    expect(entry.positions[0].top).toBeGreaterThan(earlierTop - 4);
    expect(entry.positions[0].top).toBeLessThan(earlierTop + 40);
    expect(entry.positions.at(-1)!.top).toBeGreaterThan(earlierTop + 40);
    for (let index = 1; index < entry.positions.length; index++) {
      expect(entry.positions[index].top - entry.positions[index - 1].top).toBeLessThan(55);
    }
  } finally {
    if (createdId) await page.request.delete(`${E2E_API_URL}/admin/files/${createdId}`, { headers });
    await page.request.delete(`${E2E_API_URL}/admin/files/${existingFile.id}`, { headers });
  }
});

test("a new link enters after its dialog closes and editing it does not replay entry", async ({ page }) => {
  const headers = await loginAdmin(page);
  const prefix = `New link ${crypto.randomUUID().slice(0, 8)}`;
  const existing = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
    title: `${prefix} old`, description: "", url: "", visible: false,
    icon: "link", color: "blue", request_id: crypto.randomUUID(),
  } });
  expect(existing.ok()).toBeTruthy();
  const existingLink = await existing.json();
  let createdLink: { id: number; version: number } | null = null;
  try {
    await page.goto(`/editor?tab=links&link_q=${encodeURIComponent(prefix)}`);
    await expect(page.locator(`[data-editor-links-list] [data-editor-row-id="${existingLink.id}"]`)).toBeVisible();
    await trackRowMotions(page);
    await page.getByRole("button", { name: "New Link", exact: true }).click();
    expect(await rowMotions(page)).toEqual([]);
    const dialog = page.getByRole("dialog", { name: "New link" });
    await dialog.getByLabel("TITLE", { exact: true }).fill(`${prefix} new`);
    await dialog.getByLabel("DESTINATION URL", { exact: true }).fill("https://example.com/new");
    const responsePromise = page.waitForResponse(response => response.url() === `${E2E_API_URL}/admin/links` && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Save link", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    createdLink = await response.json();
    await expect(dialog).toHaveCount(0);
    const row = page.locator(`[data-editor-links-list] [data-editor-row-id="${createdLink!.id}"]`);
    await expect(row).toBeVisible();
    await expect.poll(async () => (await rowMotions(page)).some(motion => motion.id === String(createdLink!.id) && motion.opacity === "0")).toBe(true);
    expect(await rowMotions(page)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: String(createdLink.id), duration: 180, opacity: "0", transform: "translateY(6px)" }),
    ]));
    expect((await rowMotions(page)).filter(motion => motion.id === String(createdLink.id)).every(motion => motion.background === "")).toBe(true);
    await expectEntranceGlow(page, String(createdLink.id));
    await page.evaluate(() => { (window as typeof window & { rowMotions?: RowMotion[] }).rowMotions = []; });
    await row.getByRole("button", { name: /More actions for/ }).click();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit link" });
    await editDialog.getByLabel("DESCRIPTION", { exact: true }).fill("Updated link");
    await editDialog.getByRole("button", { name: "Save link", exact: true }).click();
    await expect(editDialog).toHaveCount(0);
    expect((await rowMotions(page)).filter(motion => motion.id === String(createdLink!.id) && motion.opacity === "0")).toEqual([]);
    const updated = await page.request.get(`${E2E_API_URL}/admin/links`, { headers });
    const current = (await updated.json() as { links?: { id: number; version: number }[] } | { id: number; version: number }[]);
    const items = Array.isArray(current) ? current : current.links || [];
    createdLink.version = items.find(link => link.id === createdLink!.id)?.version || createdLink.version;
  } finally {
    if (createdLink) await page.request.delete(`${E2E_API_URL}/admin/links/${createdLink.id}`, { headers, data: { version: createdLink.version } });
    await page.request.delete(`${E2E_API_URL}/admin/links/${existingLink.id}`, { headers, data: { version: existingLink.version } });
  }
});

test("new file rows appear without entrance motion when reduced motion is requested", async ({ page }) => {
  const headers = await loginAdmin(page);
  const name = `Reduced file ${crypto.randomUUID().slice(0, 8)}`;
  let createdId: number | null = null;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/editor?tab=files&q=${encodeURIComponent(name)}`);
    await page.evaluate(() => {
      const tracked = window as typeof window & { reducedRowMotions?: number; reducedGlowEntries?: number };
      tracked.reducedRowMotions = 0;
      tracked.reducedGlowEntries = 0;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.hasAttribute("data-editor-row-id")) tracked.reducedRowMotions!++;
        return original.apply(this, args);
      };
      new MutationObserver(records => {
        for (const record of records) {
          if (record.target instanceof HTMLElement && record.target.hasAttribute("data-editor-entering")) tracked.reducedGlowEntries!++;
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-editor-entering"] });
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Upload a file" });
    await dialog.locator('input[type="file"]').setInputFiles({ name: "reduced.txt", mimeType: "text/plain", buffer: Buffer.from("Reduced motion file") });
    await dialog.getByRole("textbox", { name: /Display name/ }).fill(name);
    const responsePromise = page.waitForResponse(response => response.url() === `${E2E_API_URL}/admin/files` && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    createdId = (await response.json()).id;
    await expect(page.locator(`[data-editor-list][data-resource="files"] [data-editor-row-id="${createdId}"]`)).toBeVisible();
    expect(await page.evaluate(() => {
      const tracked = window as typeof window & { reducedRowMotions?: number; reducedGlowEntries?: number };
      return { motions: tracked.reducedRowMotions, glows: tracked.reducedGlowEntries };
    })).toEqual({ motions: 0, glows: 0 });
  } finally {
    if (createdId) await page.request.delete(`${E2E_API_URL}/admin/files/${createdId}`, { headers });
  }
});
