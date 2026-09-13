import { expect, test } from "@playwright/test";

test("sidebar selection follows client navigation and browser history", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("aside.sidebar");
  for (const [name, path] of [["Posts Playground", "/"], ["Cloud Drive", "/drive"], ["Advanced Search", "/search"], ["Login", "/login"], ["Posts Playground", "/"]]) {
    const link = sidebar.getByRole("link", { name, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}/?$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
    if (path === "/") {
      await expect(link).not.toHaveClass(/\bactive\b/);
      await page.mouse.move(600, 50);
      await expect(link).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    } else {
      await expect(link).toHaveClass(/\bactive\b/);
      await expect.poll(() => link.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    }
  }
  await page.goBack();
  await expect(sidebar.getByRole("link", { name: "Login", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(sidebar.getByRole("link", { name: "Posts Playground", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: "Posts Playground", exact: true })).not.toHaveClass(/\bactive\b/);
});
