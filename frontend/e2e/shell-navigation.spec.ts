import { expect, test } from "@playwright/test";

test("sidebar page links use a shared content transition", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Settings/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
  const topBarActions = page.locator(".top-bar-actions > button");
  await expect(topBarActions).toHaveCount(2);
  await expect(topBarActions.nth(0)).toHaveAccessibleName("Refresh page");
  await expect(topBarActions.nth(1)).toHaveAccessibleName("Switch to Light Mode");
  await topBarActions.nth(1).click();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to Dark Mode" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await expect(page.locator(".route-transition-frame")).not.toHaveClass(/route-transition-active/);

  await page.evaluate(() => {
    const trackedWindow = window as typeof window & { routeTransitionCount?: number };
    trackedWindow.routeTransitionCount = 0;
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "fadeIn"
        && event.target instanceof HTMLElement
        && event.target.classList.contains("route-transition-active")
      ) {
        trackedWindow.routeTransitionCount = (trackedWindow.routeTransitionCount || 0) + 1;
      }
    });
  });

  await page.getByRole("link", { name: "All Posts", exact: true }).click();
  await expect(page).toHaveURL(/\/posts$/);
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { routeTransitionCount?: number }).routeTransitionCount || 0,
  )).toBe(1);

  await page.getByRole("link", { name: "Cloud Drive", exact: true }).click();
  await expect(page).toHaveURL(/\/drive$/);
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { routeTransitionCount?: number }).routeTransitionCount || 0,
  )).toBe(2);

  await page.getByRole("link", { name: "Advanced Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { routeTransitionCount?: number }).routeTransitionCount || 0,
  )).toBe(3);
});

