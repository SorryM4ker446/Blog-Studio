import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/auth";
import { createArticle } from "./support/articles";
import { E2E_API_URL } from "./support/test-env";

test("category changes clear feedback from the previous article save", async ({ page }) => {
  const headers = await loginAdmin(page);
  const categoryName = `Category feedback ${crypto.randomUUID().slice(0, 8)}`;
  const createdPost = await createArticle(page.request, {
    headers,
    data: { title: `Category feedback article ${Date.now()}`, content: "Initial body", status: "draft" },
  });
  const post = await createdPost.json();
  let categoryId: number | null = null;

  try {
    await page.goto(`/editor?edit=${post.id}`);
    const body = page.locator(".custom-editor-wrapper textarea");
    await body.fill("Saved body");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#post-save-message")).toHaveText("Saved successfully!");

    await page.getByRole("button", { name: "Create category" }).click();
    await page.getByRole("textbox", { name: "Category name", exact: true }).fill(categoryName);
    const createResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/categories");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const response = await createResponse;
    expect(response.ok()).toBeTruthy();
    categoryId = (await response.json()).id;

    await expect(page.getByRole("combobox", { name: "Post category" })).toContainText(categoryName);
    await expect(page.locator(".editor-save-state > span")).toHaveText("Unsaved changes");
    await expect(page.locator("#post-save-message")).toHaveCount(0);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#post-save-message")).toHaveText("Saved successfully!");
    const categorySelect = page.getByRole("combobox", { name: "Post category" });
    await categorySelect.click();
    await page.getByRole("group", { name: `Manage ${categoryName}` }).getByRole("button", { name: `Delete ${categoryName}` }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Confirm Deletion" });
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(deleteDialog).toHaveCount(0);
    categoryId = null;
    await expect(categorySelect).toContainText("None");
    await expect(page.locator(".editor-save-state > span")).toHaveText("All changes saved");
    await expect(page.locator("#post-save-message")).toHaveCount(0);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    if (categoryId !== null) await page.request.delete(`${E2E_API_URL}/admin/categories/${categoryId}`, { headers });
  }
});

test("category rename stays steady, management clears hover, and creation opens and closes smoothly", async ({ page }) => {
  const headers = await loginAdmin(page);
  const name = `Category motion ${crypto.randomUUID().slice(0, 8)}`;
  const renamed = `${name} updated`;
  const createdName = `Created motion ${crypto.randomUUID().slice(0, 8)}`;
  const categoryIds: number[] = [];
  const initial = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name } });
  expect(initial.ok()).toBeTruthy();
  categoryIds.push((await initial.json()).id);

  try {
    await page.goto("/editor");
    await page.getByRole("button", { name: "New Post", exact: true }).click();
    const select = page.getByRole("combobox", { name: "Post category" });
    await expect(select).toBeVisible();
    await select.click();
    await page.getByRole("option", { name, exact: true }).click();
    await select.click();
    const management = page.getByRole("group", { name: `Manage ${name}` });
    const lastOption = page.getByRole("listbox", { name: "Post category" }).getByRole("option").last();
    await lastOption.hover();
    await expect(lastOption).toHaveClass(/highlighted/);
    await management.hover();
    await expect(page.locator(".custom-select-option.highlighted")).toHaveCount(0);

    await management.getByRole("button", { name: `Rename ${name}` }).click();
    const input = page.getByRole("textbox", { name: "New category name" });
    await expect(management.getByRole("button", { name: `Save ${name} rename` }).locator("svg")).toHaveCount(1);
    await expect(management.getByRole("button", { name: "Cancel rename" }).locator("svg")).toHaveCount(1);
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-category-rename-actions.png") });
    await input.fill(renamed);
    const contentLabel = page.locator("#post-content-label");
    const initialTop = await contentLabel.evaluate(node => node.getBoundingClientRect().top);
    let finishRename = () => {};
    const renameGate = new Promise<void>(resolve => { finishRename = resolve; });
    let categoryReads = 0;
    page.on("request", request => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/admin/categories") categoryReads++;
    });
    await page.route(`**/api/admin/categories/${categoryIds[0]}`, async route => {
      await renameGate;
      await route.continue();
    }, { times: 1 });
    try {
      await management.getByRole("button", { name: `Save ${name} rename` }).click();
      await expect(input).toHaveAttribute("readonly", "");
      expect(await contentLabel.evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(initialTop, 1);
    } finally {
      finishRename();
    }
    await expect(page.getByRole("group", { name: `Manage ${renamed}` })).toBeVisible();
    expect(await contentLabel.evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(initialTop, 1);
    expect(categoryReads).toBe(0);

    const shell = page.locator(".editor-category-create-shell");
    await page.getByRole("button", { name: "Create category" }).click();
    await expect(shell).toHaveAttribute("data-open", "true");
    await expect.poll(() => shell.evaluate(node => node.getAnimations().some(animation => animation.effect?.getTiming().duration === 240))).toBe(true);
    await shell.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await expect(page.getByRole("textbox", { name: "Category name", exact: true })).toHaveCSS("outline-style", "solid");
    await expect(page.locator(".editor-category-create")).toHaveCSS("overflow-clip-margin", "5px");
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-category-create-row.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(shell).toHaveAttribute("data-open", "false");
    await expect.poll(() => shell.evaluate(node => node.getAnimations().some(animation => animation.effect?.getTiming().duration === 240))).toBe(true);
    await expect(shell).toBeHidden();

    await page.getByRole("button", { name: "Create category" }).click();
    await page.getByRole("textbox", { name: "Category name", exact: true }).fill(createdName);
    const createResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/categories");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const created = await createResponse;
    expect(created.ok()).toBeTruthy();
    categoryIds.push((await created.json()).id);
    await expect(shell).toHaveAttribute("data-open", "false");
    await expect.poll(() => shell.evaluate(node => node.getAnimations().some(animation => animation.effect?.getTiming().duration === 240))).toBe(true);
    await expect(select).toContainText(createdName);

    await select.click();
    await page.getByRole("group", { name: `Manage ${createdName}` }).getByRole("button", { name: `Delete ${createdName}` }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Confirm Deletion" });
    await expect(deleteDialog).toBeVisible();
    await contentLabel.evaluate(node => {
      const tracked = node as HTMLElement & { finishPositionCheck?: () => number };
      const initial = tracked.getBoundingClientRect().top;
      let largestShift = 0;
      let frame = 0;
      const sample = () => {
        largestShift = Math.max(largestShift, Math.abs(tracked.getBoundingClientRect().top - initial));
        frame = requestAnimationFrame(sample);
      };
      sample();
      tracked.finishPositionCheck = () => { cancelAnimationFrame(frame); return largestShift; };
    });
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(select).toContainText("None");
    expect(await contentLabel.evaluate(node => (node as HTMLElement & { finishPositionCheck?: () => number }).finishPositionCheck?.())).toBeLessThan(1.5);
    expect(categoryReads).toBe(0);
  } finally {
    for (const id of categoryIds) await page.request.delete(`${E2E_API_URL}/admin/categories/${id}`, { headers });
  }
});
