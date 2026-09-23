import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`file and link edits share safe dismissal and exit motion in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const headers = await loginAdmin(page);
    const created = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
      title: "Dialog motion link", description: "Editable shortcut", url: "", visible: false,
      icon: "link", color: "blue", request_id: crypto.randomUUID(),
    } });
    expect(created.ok()).toBeTruthy();
    const link = await created.json();
    const uploaded = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
      file: { name: "dialog-motion.txt", mimeType: "text/plain", buffer: Buffer.from("Dialog verification") },
      display_name: "Dialog motion file",
    } });
    expect(uploaded.ok()).toBeTruthy();
    const file = await uploaded.json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error" && !event.text().includes("500")) errors.push(event.text()); });
    let release = () => {};
    try {
      await page.goto("/editor?tab=links");
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const motion = original.apply(this, args);
          const frames = args[0] as Keyframe[];
          if (this.hasAttribute("data-modal-panel") && Array.isArray(frames) && frames.at(-1)?.opacity === 0) motion.pause();
          return motion;
        };
      });
      for (const resource of ["links", "files"]) {
        await page.getByRole("tab", { name: new RegExp(`^${resource}`, "i") }).click();
        const row = resource === "links" ? page.getByRole("article", { name: link.title, exact: true }) : page.locator(`[data-file-id="${file.id}"]`);
        const edit = row.getByRole("button", { name: "Edit", exact: true });
        const dialog = page.getByRole("dialog", { name: resource === "links" ? "Edit link" : "Edit file details", exact: true });
        const overlay = page.locator("[data-modal-overlay]");
        const finishExit = async () => {
          await expect(overlay).toHaveAttribute("data-state", "closing");
          await expect(dialog).toBeAttached();
          await expect(dialog).toBeFocused();
          expect(await dialog.locator("[inert]").count()).toBe(1);
          expect(await page.locator(".editor-list-toolbar").evaluate(node => Boolean(node.closest("[inert]")))).toBe(true);
          await dialog.evaluate(node => node.getAnimations().forEach(motion => motion.finish()));
          await expect(dialog).toHaveCount(0);
        };
        for (const dismiss of ["Cancel", "Close dialog", "Escape", "backdrop"]) {
          await edit.click();
          await expect(dialog).toBeVisible();
          if (dismiss === "Cancel") {
            // Releasing a drag on the backdrop must not dismiss the dialog.
            const box = (await dialog.boundingBox())!;
            await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
            await page.mouse.move(4, 4); await page.mouse.up();
            await expect(overlay).toHaveAttribute("data-state", "open");
            await page.mouse.move(4, 4); await page.mouse.down();
            await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.up();
            await expect(overlay).toHaveAttribute("data-state", "open");
            await page.evaluate(() => window.getSelection()?.removeAllRanges());
            await scanAccessibility(page, info, `${resource}-edit-${theme}`);
            await page.screenshot({ path: path.join(os.tmpdir(), `blog-${resource}-edit-${theme}.png`) });
          }
          if (dismiss === "Escape") await page.keyboard.press("Escape");
          else if (dismiss === "backdrop") await overlay.click({ position: { x: 4, y: 4 } });
          else await dialog.getByRole("button", { name: dismiss, exact: true }).click();
          await finishExit();
          await expect(edit).toBeFocused();
        }
        await edit.click();
        const input = resource === "links" ? dialog.getByLabel("TITLE", { exact: true }) : dialog.getByRole("textbox", { name: /Display name/ });
        const updatedTitle = `Saved ${resource} motion`;
        await input.fill(updatedTitle);
        const gate = new Promise<void>(resolve => { release = resolve; });
        let writes = 0;
        const endpoint = `**/api/admin/${resource}/${resource === "links" ? link.id : file.id}`;
        await page.route(endpoint, async route => {
          if (!["PUT", "PATCH"].includes(route.request().method())) return route.continue();
          writes++;
          if (writes === 1) { await gate; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Temporary save failure" }) }); }
          await route.continue();
        });
        const save = dialog.getByRole("button", { name: resource === "links" ? "Save link" : "Save changes", exact: true });
        await save.click();
        await expect(dialog).toHaveAttribute("aria-busy", "true");
        await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeDisabled();
        await page.keyboard.press("Escape");
        await overlay.click({ position: { x: 4, y: 4 } });
        await expect(overlay).toHaveAttribute("data-state", "open");
        release();
        await expect(dialog.getByRole("alert")).toContainText("Temporary save failure");
        await expect(input).toHaveValue(updatedTitle);
        await save.click();
        await expect(overlay).toHaveAttribute("data-state", "closing");
        await expect(dialog).toHaveAttribute("aria-busy", "true");
        if (resource === "links") await expect(save).toHaveText("Save link");
        else await expect(dialog.locator('button[type="submit"], button').filter({ hasText: "Saving…" })).toHaveCount(1);
        await finishExit();
        expect(writes).toBe(2);
        await page.unroute(endpoint);
        const updated = await page.request.get(`${E2E_API_URL}/admin/${resource}`, { headers });
        expect(JSON.stringify(await updated.json())).toContain(updatedTitle);

        await page.setViewportSize({ width: 375, height: 850 });
        const updatedRow = resource === "links" ? page.getByRole("article", { name: updatedTitle, exact: true }) : row;
        await updatedRow.getByRole("button", { name: "Edit", exact: true }).click();
        await expectNoOverflow(page);
        await scanAccessibility(page, info, `${resource}-edit-mobile-${theme}`);
        await page.screenshot({ path: path.join(os.tmpdir(), `blog-${resource}-edit-mobile-${theme}.png`) });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await dialog.getByRole("button", { name: "Close dialog" }).click();
        await expect(dialog).toHaveCount(0);
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      expect(errors).toEqual([]);
    } finally {
      release();
      const current = await page.request.get(`${E2E_API_URL}/admin/links`, { headers });
      const links = await current.json();
      const saved = links.find((item: { id: number }) => item.id === link.id);
      if (saved) await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: saved.version } });
      await page.request.delete(`${E2E_API_URL}/admin/files/${file.id}`, { headers });
    }
  });
}
