import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { expectNoOverflow, loginAdmin, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`settings dialogs save, cancel and restore focus in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    const headers = await loginAdmin(page);
    const original = await (await page.request.get(`${E2E_API_URL}/settings`)).json();
    try {
      for (const [key, limit] of [["profile_name", 20], ["profile_description", 100]] as const) {
        const rejected = await page.request.put(`${E2E_API_URL}/admin/settings`, {
          headers, data: { [key]: "😀".repeat(limit + 1) },
        });
        expect(rejected.status()).toBe(400);
        const accepted = await page.request.put(`${E2E_API_URL}/admin/settings`, {
          headers, data: { [key]: "😀".repeat(limit) },
        });
        expect(accepted.ok()).toBeTruthy();
      }
      await page.request.put(`${E2E_API_URL}/admin/settings`, { headers, data: original });
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: width === 375 ? "reduce" : "no-preference" });
        await page.goto("/settings");
        await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
        await expect(page.getByLabel("Profile Name", { exact: true })).toHaveCount(0);
        await expectNoOverflow(page);
        await scanAccessibility(page, info, `settings-${width}`);
        await info.attach(`settings-${width}`, { body: await page.screenshot({ path: path.join(os.tmpdir(), `blog-settings-${theme}-${width}.png`) }), contentType: "image/png" });
        const edit = page.getByRole("button", { name: "Edit profile", exact: true });
        await edit.click();
        let dialog = page.getByRole("dialog", { name: "Edit profile" });
        const name = dialog.getByLabel("Profile Name", { exact: true });
        await expect(name).toBeFocused();
        const savedName = await name.inputValue();
        await name.fill("Unsaved profile");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(edit).toBeFocused();
        await edit.press("Enter");
        dialog = page.getByRole("dialog", { name: "Edit profile" });
        await expect(dialog.getByLabel("Profile Name", { exact: true })).toHaveValue(savedName);
        await dialog.getByLabel("Profile Name", { exact: true }).fill(`Profile ${theme} ${width}`);
        await scanAccessibility(page, info, `profile-dialog-${width}`);
        await expectNoOverflow(page);
        await info.attach(`profile-dialog-${width}`, { body: await page.screenshot({ path: path.join(os.tmpdir(), `blog-profile-dialog-${theme}-${width}.png`) }), contentType: "image/png" });
        await dialog.getByRole("button", { name: "Save Configuration" }).focus();
        await page.keyboard.press("Tab");
        await expect(dialog.getByRole("button", { name: "Close settings dialog" })).toBeFocused();
        await dialog.getByRole("button", { name: "Save Configuration" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(edit).toBeFocused();
        await page.reload();
        await expect(page.getByRole("heading", { name: `Profile ${theme} ${width}`, exact: true })).toBeVisible();

        const security = page.getByRole("button", { name: "Change password", exact: true });
        await security.click();
        dialog = page.getByRole("dialog", { name: "Change password" });
        await expect(dialog.getByLabel("Current Password", { exact: true })).toBeFocused();
        await dialog.getByRole("button", { name: "Update Password" }).click();
        await expect(dialog.getByText("Enter your current password.")).toBeVisible();
        await expect(dialog.getByText("Enter a new password.")).toBeVisible();
        await expect(dialog.locator("form")).toHaveAttribute("novalidate", "");
        await page.screenshot({ path: path.join(os.tmpdir(), `blog-password-validation-${theme}-${width}.png`) });
        await dialog.getByLabel("Current Password", { exact: true }).fill("test-only-unsent-password");
        await scanAccessibility(page, info, `security-dialog-${width}`);
        await expectNoOverflow(page);
        await dialog.getByRole("button", { name: "Close settings dialog" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(security).toBeFocused();
        await security.click();
        await expect(page.getByLabel("Current Password", { exact: true })).toHaveValue("");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        if (width === 1440) await page.evaluate(() => {
          const original = Element.prototype.animate;
          Element.prototype.animate = function (frames, options) {
            const animation = original.call(this, frames, options);
            if (this.hasAttribute("data-modal-panel")) animation.pause();
            return animation;
          };
        });
        const logout = page.getByRole("button", { name: "Log Out Securely" });
        await logout.click();
        const confirmation = page.getByRole("dialog", { name: "Confirm Logout" });
        if (width === 1440) {
          const opacity = await confirmation.evaluate(panel => {
            const animation = panel.getAnimations()[0];
            if (!animation) throw new Error("Missing confirmation entry animation");
            animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
            const opacity = Number(getComputedStyle(panel).opacity);
            animation.finish();
            return opacity;
          });
          expect(opacity).toBeGreaterThan(0);
          expect(opacity).toBeLessThan(1);
        }
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
        if (width === 1440) {
          await expect(page.locator('[data-modal-overlay]')).toHaveAttribute("data-state", "closing");
          await expect(confirmation).toHaveCount(1);
          await confirmation.evaluate(panel => {
            const animation = panel.getAnimations()[0];
            if (!animation) throw new Error("Missing confirmation exit animation");
            animation.finish();
          });
        }
        await expect(confirmation).toHaveCount(0);
        await expect(logout).toBeFocused();
      }
    } finally {
      const restored = await page.request.put(`${E2E_API_URL}/admin/settings`, { headers, data: {
        profile_name: original.profile_name || "", profile_description: original.profile_description || "", profile_tag: original.profile_tag || "admin",
      } });
      expect(restored.ok()).toBe(true);
    }
  });
}
