import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/accessibility";
import { E2E_API_URL } from "./support/test-env";

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
    await expect(row.getByText("Text document", { exact: true })).toBeVisible();
    await expect(row.getByText("text/plain", { exact: true })).toHaveCount(0);
    const more = row.getByRole("button", { name: "More actions for Actions note" });
    const normalRowBackground = await row.evaluate(node => getComputedStyle(node).backgroundColor);
    const rowIndicatorOpacity = () => row.evaluate(node => getComputedStyle(node, "::after").opacity);
    const rowWashOpacity = () => row.evaluate(node => getComputedStyle(node, "::before").opacity);
    const normalMoreBackground = await more.evaluate(node => getComputedStyle(node).backgroundColor);
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
    await expect.poll(() => more.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(normalMoreBackground);
    await menu.hover();
    await expect.poll(rowIndicatorOpacity).toBe("1");
    await more.click();
    await expect(menu).toHaveCount(0);
    await expect(row.locator('[role="group"]')).toHaveCSS("visibility", "hidden");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await more.click();
    await expect(row.getByRole("group", { name: "Actions for Actions note" })).toHaveCSS("opacity", "1");
    expect(await row.locator('[role="group"]').evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  } finally {
    const deleted = await page.request.delete(`${E2E_API_URL}/admin/files/${file.id}`, { headers });
    expect(deleted.ok()).toBeTruthy();
  }
});
