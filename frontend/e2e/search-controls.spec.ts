import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`dropdowns remain usable during repeated toggles with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/search");
    const scope = page.getByRole("combobox", { name: "Search scope" });
    const menu = page.locator(".custom-select-options").filter({ has: page.locator('[role="option"]', { hasText: "Posts and files" }) });
    await scope.click();
    await expect(menu).toHaveCSS("opacity", "1");
    await scope.press("Escape");
    await expect(scope).toBeFocused();
    await expect(menu).toHaveAttribute("inert", "");
    await expect(page.getByRole("listbox", { name: "Search scope" })).toHaveCount(0);

    // Reopen before the exit transition completes, then select with the keyboard.
    await scope.press("ArrowDown");
    await scope.press("ArrowDown");
    await scope.press("Enter");
    await expect(scope).toContainText("Posts");
    await expect(scope).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    expect(new URL(page.url()).searchParams.get("scope")).toBe("posts");

    await scope.click();
    await expect(menu).toBeVisible();
    await expect(menu).not.toHaveAttribute("inert");
    if (reducedMotion === "reduce") {
      await expect(menu).toHaveCSS("transition-duration", "0s");
      await expect(scope.locator(".custom-select-arrow")).toHaveCSS("transition-duration", "0s");
    }
    await page.getByRole("heading", { name: "Search", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(scope).toHaveAttribute("aria-expanded", "false");
  });
}

test("unavailable categories stay explicit and long dropdowns keep keyboard choices visible", async ({ page }) => {
  await page.goto("/search?q=controls&scope=posts&category=999999");
  const category = page.getByRole("combobox", { name: "Search category" });
  await expect(category).toContainText("Unavailable category");
  await expect(category).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).searchParams.get("category")).toBe("999999");
  const categories = Array.from({ length: 20 }, (_, index) => ({ id: index + 100, name: `Category ${index + 1}`, post_count: 1 }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/categories", async route => { await gate; await route.fulfill({ json: categories }); });
  try {
    await category.click();
    await page.getByRole("option", { name: "All categories", exact: true }).click();
    await expect(page.getByRole("region", { name: "Search results" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCSS("opacity", "1");
    expect(new URL(page.url()).searchParams.has("category")).toBe(false);
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  } finally { release(); }
  await expect(page.getByRole("region", { name: "Search results" })).toHaveAttribute("aria-busy", "false");
  await category.click();
  await expect(page.getByRole("option", { name: "Category 20", exact: true })).toBeAttached();
  for (const key of ["End", "Home", "ArrowUp", "ArrowDown"]) {
    await category.press(key);
    await expect.poll(() => category.evaluate(element => {
      const option = document.getElementById(element.getAttribute("aria-activedescendant")!)!;
      const menu = document.getElementById(element.getAttribute("aria-controls")!)!;
      const a = option.getBoundingClientRect();
      const b = menu.getBoundingClientRect();
      return a.top >= b.top && a.bottom <= b.bottom;
    })).toBe(true);
  }
  await category.press("End");
  await category.press("Enter");
  await expect(category).toContainText("Category 20");
  await expect(category).toBeFocused();
  expect(new URL(page.url()).searchParams.get("category")).toBe("119");
  await category.click();
  await expect(page.getByRole("option", { name: "Category 20", exact: true })).toBeInViewport();
  await category.press("Escape");
  await expect(category).toHaveAttribute("aria-expanded", "false");
});
