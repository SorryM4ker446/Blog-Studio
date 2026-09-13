import { expect, test } from "@playwright/test";
import { E2E_APP_URL } from "./support/test-env";
import { expectNoOverflow, loginAdmin, scanAccessibility } from "./support/accessibility";

test("mobile navigation traps focus, preserves desktop cookies and closes only after committed navigation", async ({ page, context }, info) => {
  await context.addCookies([{ name: "sidebar_collapsed", value: "true", url: E2E_APP_URL }]);
  await loginAdmin(page);
  await page.goto("/editor?edit=new");
  await page.getByLabel("POST TITLE").fill("Mobile unsaved draft");
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Site navigation" });
  const close = drawer.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: "Settings (Admin)" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  expect(await drawer.evaluate(element => element.matches(":modal"))).toBe(true);
  await scanAccessibility(page, info, "drawer");
  const destination = drawer.getByRole("link", { name: "Cloud Drive", exact: true });
  await destination.press("Enter");
  const leave = page.getByRole("alertdialog", { name: "Leave this editor?" });
  await expect(leave).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(destination).toBeFocused();
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/edit=new/);
  await destination.press("Enter");
  await leave.getByRole("button", { name: "Leave editor", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/drive$/);
  await expect(page.locator('aside.sidebar a[href="/drive"]')).toHaveAttribute("aria-current", "page");
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await trigger.press("Enter");
  await expect(drawer.getByRole("link", { name: "Cloud Drive", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await page.mouse.click(365, 400);
  await expect(drawer).not.toBeVisible();
  expect((await context.cookies()).find(cookie => cookie.name === "sidebar_collapsed")?.value).toBe("true");
  await trigger.press("Enter");
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
});

test("mobile pages and editor fit narrow viewports without changing desktop article budgets", async ({ page }, info) => {
  await loginAdmin(page);
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 850 });
    for (const path of ["/", "/posts", "/drive", "/search?q=article", "/editor", "/settings", "/editor?edit=new"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      if (path.includes("edit=new")) await expect(page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true })).toBeVisible();
      await expectNoOverflow(page);
    }
    await page.screenshot({ path: info.outputPath(`editor-${width}.png`), animations: "disabled", scale: "css" });
  }
});

test("reduced motion disables actual shell, route, drawer and editor transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation", exact: true }).press("Enter");
  await page.getByRole("dialog").getByRole("link", { name: "All Posts", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/posts$/);
  await page.getByRole("button", { name: "Switch to Light Mode" }).press("Enter");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
});
