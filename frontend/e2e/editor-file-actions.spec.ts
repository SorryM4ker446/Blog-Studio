import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/accessibility";
import { E2E_API_URL } from "./support/test-env";

test("selected file types use supported extensions before upload", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/editor?tab=files");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a file" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "assets.zip",
    mimeType: "application/x-zip-compressed",
    buffer: Buffer.from("archive"),
  });
  await expect(dialog.getByText("7 B · ZIP archive")).toBeVisible();
  await expect(dialog.getByText(/Other file/)).toHaveCount(0);
  await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-zip-selection.png") });
  await dialog.getByRole("button", { name: "Replace" }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "data.csv",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("a,b"),
  });
  await expect(dialog.getByText("3 B · CSV data")).toBeVisible();
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-csv-selection.png") });
});

test("file rows show readable types and compact animated actions", async ({ page }) => {
  const headers = await loginAdmin(page);
  const uploaded = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
    file: { name: "actions-note.txt", mimeType: "text/plain", buffer: Buffer.from("Editor file action check.") },
    display_name: "Actions note", description: "",
  } });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  try {
    await page.goto("/editor?tab=files");
    const row = page.locator(`[data-file-id="${file.id}"]`);
    await expect(row.getByText("No description provided.", { exact: true })).toBeVisible();
    await expect(row.getByText("actions-note.txt", { exact: true })).toHaveCount(0);
    await expect(row.getByText("Text document", { exact: true })).toBeVisible();
    await expect(row.getByText("text/plain", { exact: true })).toHaveCount(0);
    const more = row.getByRole("button", { name: "More actions for Actions note" });
    const normalRowBackground = await row.evaluate(node => getComputedStyle(node).backgroundColor);
    const rowIndicatorOpacity = () => row.evaluate(node => getComputedStyle(node, "::after").opacity);
    const rowWashOpacity = () => row.evaluate(node => getComputedStyle(node, "::before").opacity);
    const normalMoreBackground = await more.evaluate(node => getComputedStyle(node).backgroundColor);
    const expandedMoreBackground = await more.evaluate(node => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--bg-hover)";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(await rowIndicatorOpacity()).toBe("0");
    expect(await rowWashOpacity()).toBe("0");
    const box = await more.boundingBox();
    expect(box!.width).toBeLessThan(70);
    expect(box!.height).toBe(30);
    await more.click();
    const menu = row.getByRole("group", { name: "Actions for Actions note" });
    await expect(menu).toHaveCSS("opacity", "1");
    expect(await menu.evaluate(node => getComputedStyle(node).transitionDuration)).toContain("0.16s");
    await expect(menu.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Download" })).toBeVisible();
    await page.getByRole("heading", { name: "Content Editor" }).hover();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => row.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(normalRowBackground);
    await expect.poll(rowIndicatorOpacity).toBe("1");
    await expect.poll(rowWashOpacity).toBe("1");
    expect(await row.evaluate(node => getComputedStyle(node, "::after").width)).toBe("2px");
    await expect(more).toHaveCSS("background-color", expandedMoreBackground);
    await menu.hover();
    await expect.poll(rowIndicatorOpacity).toBe("1");
    await more.click();
    await expect(menu).toHaveCount(0);
    await expect(row.locator('[role="group"]')).toHaveCSS("visibility", "hidden");
    await page.getByRole("heading", { name: "Content Editor" }).hover();
    await expect(more).toHaveCSS("background-color", normalMoreBackground);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await more.click();
    await expect(row.getByRole("group", { name: "Actions for Actions note" })).toHaveCSS("opacity", "1");
    expect(await row.locator('[role="group"]').evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  } finally {
    const deleted = await page.request.delete(`${E2E_API_URL}/admin/files/${file.id}`, { headers });
    expect(deleted.ok()).toBeTruthy();
  }
});
