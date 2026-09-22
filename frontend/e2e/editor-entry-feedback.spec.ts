import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const reducedMotion of [false, true]) {
  test(`Edit retains the list until the full editor is ready (reduced motion: ${reducedMotion})`, async ({ page }) => {
    const headers = await loginAdmin(page);
    const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers,
      data: { title: `Deferred editor ${Date.now()}`, content: "Complete article body" } });
    expect(response.ok()).toBeTruthy();
    const post = await response.json();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
      await page.goto(`/editor?q=${encodeURIComponent(post.title)}`);
      const card = page.locator(".editor-post-card").filter({ hasText: post.title });
      const edit = card.getByRole("button", { name: "Edit", exact: true });
      const before = await edit.boundingBox();
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>("[data-editor-view]")!;
        frame.dataset.entries = "0";
        frame.addEventListener("animationstart", event => {
          if (event.target === frame) frame.dataset.entries = String(Number(frame.dataset.entries) + 1);
        });
      });
      let reads = 0;
      await page.route(`**/api/admin/posts/${post.id}`, async route => {
        if (route.request().method() !== "GET") return route.continue();
        reads++;
        await gate;
        await route.continue();
      });
      await edit.click();
      await expect(edit).toBeDisabled();
      await expect(edit).toHaveText("Edit");
      await expect(edit.locator(".editor-opening-icon")).toBeVisible();
      await expect(page.locator("[data-editor-view]")).toHaveAttribute("data-editor-view", "list");
      await expect(page.locator("[data-editor-view]")).toHaveAttribute("data-entries", "0");
      await expect(page.getByText("Loading article…", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      expect(await edit.boundingBox()).toEqual(before);
      // Repeated card activation must not start another detail request.
      await card.getByRole("button", { name: `Open ${post.title}`, exact: true }).click();
      release();
      await expect(page.locator(".custom-editor-wrapper textarea")).toHaveValue(post.content);
      await expect(page.locator("#post-title")).toHaveValue(post.title);
      await expect(page.locator("[data-editor-view]")).toHaveAttribute("data-entries", reducedMotion ? "0" : "1");
      expect(reads).toBe(1);
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
      await page.goForward();
      await expect(page.locator(".custom-editor-wrapper textarea")).toHaveValue(post.content);
      expect(errors).toEqual([]);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
      await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    }
  });
}

for (const theme of ["dark", "light"]) {
  test(`required field feedback follows the ${theme} theme on desktop and mobile`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await loginAdmin(page);
    await page.goto("/editor?edit=new");
    const title = page.locator("#post-title");
    const content = page.locator(".custom-editor-wrapper textarea");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    await expect(page.locator(".editor-field-error")).toHaveCount(0);
    await save.click();
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Please enter a post title.", { exact: true })).toBeVisible();
    await expect(content).toHaveAttribute("aria-invalid", "true");
    expect(await title.evaluate(node => (node.closest("form") as HTMLFormElement).noValidate)).toBe(true);
    await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-validation-${theme}.png`) });
    await scanAccessibility(page, info, `validation-${theme}`);
    await title.fill("   ");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(title).toBeFocused();
    await title.fill("A valid title");
    await expect(page.locator("#post-title-error")).toHaveCount(0);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(content).toBeFocused();
    await page.setViewportSize({ width: 375, height: 850 });
    await expectNoOverflow(page);
    await content.fill("Valid article body");
    await expect(page.locator(".editor-field-error")).toHaveCount(0);
    await title.fill("");
    await save.click();
    await expect(title).toBeFocused();
    await expectNoOverflow(page);
    await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-validation-mobile-${theme}.png`) });
  });
}
