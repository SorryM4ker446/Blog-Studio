import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`editor actions and deletion entrance/exit stay consistent in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const headers = await loginAdmin(page);
    const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
      title: "Animated deletion", description: "A link for checking editor actions.", url: "", visible: false,
      icon: "link", color: "blue", request_id: crypto.randomUUID(),
    } });
    expect(response.ok()).toBeTruthy();
    const link = await response.json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error" && !event.text().includes("500")) errors.push(event.text()); });
    let release = () => {};
    try {
      await page.goto("/editor?tab=links");
      await expect(page).toHaveTitle("Blog Studio");
      for (const resource of ["posts", "files", "links"]) {
        await page.getByRole("tab", { name: new RegExp(`^${resource}`, "i") }).click();
        await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `editor-${resource}-tab`);
        const primary = page.locator(".editor-list-actions .editor-primary-action");
        const search = page.locator(".editor-search-control");
        expect(Math.abs((await primary.boundingBox())!.height - (await search.boundingBox())!.height)).toBeLessThanOrEqual(1);
        await expect(primary).toHaveCSS("border-radius", "7px");
        await expect(search.getByRole("button", { name: "Submit search" })).toBeVisible();
      }
      await page.getByPlaceholder("Search links...").fill("missing destination");
      await page.getByRole("button", { name: "Submit search", exact: true }).click();
      await expect(page.getByRole("heading", { name: "No matching links", exact: true })).toBeVisible();
      await page.getByPlaceholder("Search links...").clear();
      await expect(page.getByPlaceholder("Search links...")).toHaveCSS("box-shadow", "none");
      await expect(page.getByPlaceholder("Search links...")).toHaveCSS("outline-style", "none");
      await expect(page.locator(".editor-search-control")).not.toHaveCSS("box-shadow", "none");
      const row = page.getByRole("article", { name: link.title, exact: true });
      await expect(row).toBeVisible();
      await scanAccessibility(page, info, `editor-toolbar-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-actions-${theme}.png`) });
      // Pause actual exit animations so the intermediate mounted/isolation state is deterministic.
      await page.evaluate(() => {
        const original = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const motion = original.apply(this, args);
          const frames = args[0] as Keyframe[];
          if (this.classList.contains("editor-delete-dialog") && Array.isArray(frames) && frames.at(-1)?.opacity === 0) motion.pause();
          return motion;
        };
      });
      const dialog = page.getByRole("alertdialog", { name: "Confirm Deletion" });
      const overlay = page.locator(".editor-delete-overlay");
      const finishExit = async () => {
        await expect(overlay).toHaveAttribute("data-state", "closing");
        await expect(dialog).toHaveText(/delete this link/);
        await expect(dialog.locator(".editor-delete-confirm")).toBeDisabled();
        expect(await page.locator(".editor-list-toolbar").evaluate(node => Boolean(node.closest("[inert]")))).toBe(true);
        await dialog.evaluate(node => node.getAnimations().forEach(motion => motion.finish()));
        await expect(dialog).toHaveCount(0);
      };
      for (const dismiss of ["Cancel", "Escape", "backdrop"]) {
        await row.getByRole("button", { name: "Delete", exact: true }).click();
        await expect(overlay).toHaveAttribute("data-state", "open");
        expect(await dialog.evaluate(node => node.getAnimations().some(motion => motion.effect?.getTiming().duration === 240))).toBe(true);
        if (dismiss === "Cancel") {
          await scanAccessibility(page, info, `delete-dialog-${theme}`);
          await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-delete-${theme}.png`) });
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        } else if (dismiss === "Escape") await page.keyboard.press("Escape");
        else await overlay.click({ position: { x: 8, y: 8 } });
        await finishExit();
        await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
      }
      const gate = new Promise<void>(resolve => { release = resolve; });
      let requests = 0;
      await page.route(`**/api/admin/links/${link.id}`, async route => {
        if (route.request().method() !== "DELETE") return route.continue();
        requests++;
        if (requests === 1) { await gate; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Temporary deletion failure" }) }); }
        await route.continue();
      });
      await row.getByRole("button", { name: "Delete", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(dialog).toHaveAttribute("aria-busy", "true");
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape"); await expect(overlay).toHaveAttribute("data-state", "open");
      release();
      await expect(dialog.getByRole("alert")).toContainText("Temporary deletion failure");
      await expect(overlay).toHaveAttribute("data-state", "open");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(overlay).toHaveAttribute("data-state", "closing");
      await finishExit();
      await expect(row).toHaveCount(0);
      await expect(page.getByRole("tabpanel")).toBeFocused();
      await page.setViewportSize({ width: 375, height: 850 });
      await expectNoOverflow(page);
      await scanAccessibility(page, info, `editor-toolbar-mobile-${theme}`);
      expect(errors).toEqual([]);
    } finally {
      release();
      await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: link.version } });
    }
  });
}
