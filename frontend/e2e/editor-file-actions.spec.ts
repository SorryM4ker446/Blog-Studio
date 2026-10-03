import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/auth";
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
  await expect(dialog.locator('[data-file-icon="attachment"]')).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-zip-selection.png") });
  const replace = dialog.getByRole("button", { name: "Replace" });
  const restingBackground = await replace.evaluate(node => getComputedStyle(node).backgroundColor);
  await replace.hover();
  await expect.poll(() => replace.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(restingBackground);
  await replace.click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "data.csv",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("a,b"),
  });
  await expect(dialog.getByText("3 B · CSV data")).toBeVisible();
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-csv-selection.png") });
});

test("upload progress appears after submitting and a failed transfer can be retried", async ({ page }) => {
  const headers = await loginAdmin(page);
  await page.goto("/editor?tab=files");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a file" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "upload-progress.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(64 * 1024, "a"),
  });
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  let releaseResponse: () => void = () => undefined;
  const holdResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route(`${E2E_API_URL}/admin/files`, async route => {
    await holdResponse;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Test upload failed" }) });
  });
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog.getByRole("progressbar", { name: "File upload progress" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Replace" })).toBeDisabled();
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-upload-progress-desktop.png") });
  await page.setViewportSize({ width: 375, height: 850 });
  await expect(dialog.getByRole("progressbar", { name: "File upload progress" })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-upload-progress-mobile.png") });
  releaseResponse();
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toHaveText("Test upload failed");
  await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.unroute(`${E2E_API_URL}/admin/files`);
  const retryResponse = page.waitForResponse(response => response.url() === `${E2E_API_URL}/admin/files` && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await retryResponse;
  expect(response.ok()).toBeTruthy();
  const uploaded = await response.json();
  try {
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-file-id="${uploaded.id}"]`)).toBeVisible();
  } finally {
    const deleted = await page.request.delete(`${E2E_API_URL}/admin/files/${uploaded.id}`, { headers });
    expect(deleted.ok()).toBeTruthy();
  }
});

test("unsupported files keep their error and card stable across repeated upload clicks", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/editor?tab=files");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload a file" });
  const input = dialog.locator('input[type="file"]');
  const upload = dialog.getByRole("button", { name: "Upload", exact: true });
  let uploadRequests = 0;
  page.on("request", request => {
    if (request.url() === `${E2E_API_URL}/admin/files` && request.method() === "POST") uploadRequests++;
  });
  await input.setInputFiles({
    name: "favicon.ico", mimeType: "image/x-icon", buffer: Buffer.from("unsupported icon format"),
  });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog.getByRole("alert")).toContainText("File extension and content type must match an allowed format");
  await expect(upload).toBeDisabled();
  const before = await dialog.boundingBox();
  expect(before).not.toBeNull();
  await page.evaluate(() => {
    const tracked = window as typeof window & { uploadDialogFrames?: { elapsed: number; y: number; height: number; fieldY: number; cardText: string; errorText: string; progress: boolean }[] };
    tracked.uploadDialogFrames = [];
    const started = performance.now();
    const sample = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][data-modal-panel]');
      if (dialog) {
        const rect = dialog.getBoundingClientRect();
        const field = dialog.querySelector<HTMLInputElement>('input[placeholder="File name shown in Drive"]');
        tracked.uploadDialogFrames?.push({
          elapsed: performance.now() - started, y: rect.y, height: rect.height,
          fieldY: field?.getBoundingClientRect().y || 0,
          cardText: dialog.querySelector('[data-file-icon="attachment"]')?.parentElement?.textContent || "",
          errorText: dialog.querySelector('[role="alert"]')?.textContent || "",
          progress: Boolean(dialog.querySelector('[role="progressbar"]')),
        });
      }
      if (performance.now() - started < 300) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const buttonBox = (await upload.boundingBox())!;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  }
  await expect.poll(() => page.evaluate(() => (window as typeof window & { uploadDialogFrames?: { elapsed: number }[] }).uploadDialogFrames?.at(-1)?.elapsed || 0)).toBeGreaterThan(290);
  expect(uploadRequests).toBe(0);
  const after = await dialog.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
  const frames = await page.evaluate(() => (window as typeof window & { uploadDialogFrames?: { y: number; height: number; fieldY: number; cardText: string; errorText: string; progress: boolean }[] }).uploadDialogFrames || []);
  expect(frames.length).toBeGreaterThan(1);
  expect(Math.max(...frames.map(frame => frame.y)) - Math.min(...frames.map(frame => frame.y))).toBeLessThan(2);
  expect(Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height))).toBeLessThan(2);
  expect(Math.max(...frames.map(frame => frame.fieldY)) - Math.min(...frames.map(frame => frame.fieldY))).toBeLessThan(2);
  expect(frames.every(frame => frame.cardText.includes("favicon.ico") && frame.errorText.includes("File extension and content type") && !frame.progress)).toBe(true);
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-editor-invalid-upload-stable.png") });

  await input.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not a PNG") });
  await expect(upload).toBeEnabled();
  const responsePromise = page.waitForResponse(response => response.url() === `${E2E_API_URL}/admin/files` && response.request().method() === "POST");
  await upload.click();
  const response = await responsePromise;
  expect(response.status()).toBe(415);
  await expect(dialog.getByRole("alert")).toContainText("File extension and content type must match an allowed format");
  await expect(upload).toBeDisabled();
  const blockedButtonBox = (await upload.boundingBox())!;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(blockedButtonBox.x + blockedButtonBox.width / 2, blockedButtonBox.y + blockedButtonBox.height / 2);
  }
  expect(uploadRequests).toBe(1);
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
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
    const expandedMoreBackground = await more.evaluate(() => {
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
