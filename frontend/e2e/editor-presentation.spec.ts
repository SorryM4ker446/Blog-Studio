import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`editor category controls and action colors in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    const headers = await loginAdmin(page);
    const categoryResponse = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name: "Selected category animation" } });
    expect(categoryResponse.ok()).toBeTruthy();
    const category = await categoryResponse.json();
    const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title: "Editor action preview", content: "Saved content", category_id: category.id } });
    const post = await response.json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.goto("/editor");
      const primary = page.locator(".editor-primary-action");
      await expect(primary).toHaveCSS("background-color", theme === "dark" ? "rgb(227, 227, 227)" : "rgb(23, 101, 204)");
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-new-${theme}.png`) });
      await page.goto(`/editor?edit=${post.id}`);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCSS("background-color", theme === "dark" ? "rgb(227, 227, 227)" : "rgb(23, 101, 204)");
      await page.getByRole("button", { name: "Create category", exact: true }).click();
      const create = page.getByRole("button", { name: "Create", exact: true });
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      const createBox = (await create.boundingBox())!, cancelBox = (await cancel.boundingBox())!;
      expect(createBox.width).toBe(cancelBox.width); expect(createBox.height).toBe(cancelBox.height);
      await scanAccessibility(page, info, `editor-category-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-category-${theme}.png`) });
      await cancel.click();
      const select = page.getByRole("combobox", { name: "Post category" });
      const menu = page.locator(".custom-select-options");
      await select.click();
      await expect(menu).toHaveCSS("opacity", "1");
      await page.getByRole("option", { name: "Selected category animation", exact: true }).click();
      await expect(select).toHaveAttribute("aria-expanded", "false");
      const intermediate = await menu.evaluate(node => {
        const animations = node.getAnimations();
        for (const motion of animations) { motion.pause(); motion.currentTime = 100; }
        return { animations: animations.length, opacity: Number(getComputedStyle(node).opacity), visibility: getComputedStyle(node).visibility };
      });
      expect(intermediate.animations).toBeGreaterThan(0);
      expect(intermediate.opacity).toBeGreaterThan(0); expect(intermediate.opacity).toBeLessThan(1);
      expect(intermediate.visibility).toBe("visible");
      await expect(menu).toHaveAttribute("inert");
      await menu.evaluate(node => node.getAnimations().forEach(motion => motion.finish()));
      await expect(menu).toHaveCSS("visibility", "hidden");
      await expect(select).toBeFocused();
      await page.setViewportSize({ width: 375, height: 850 });
      await page.getByRole("button", { name: "Create category", exact: true }).click();
      await expectNoOverflow(page);
      await scanAccessibility(page, info, `editor-category-mobile-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-category-mobile-${theme}.png`) });
      expect(errors).toEqual([]);
    } finally {
      await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
      await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
    }
  });
}
