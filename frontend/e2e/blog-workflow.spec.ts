import { expect, test } from "@playwright/test";
import {
  E2E_ADMIN_PASS,
  E2E_ADMIN_USER,
  E2E_API_URL,
} from "./support/test-env";

const onePixelPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("administrator can draft, publish, and log out", async ({ page, request }) => {
  const postTitle = `E2E workflow ${Date.now()}`;

  await page.goto("/login?redirect=/settings");
  await page.getByPlaceholder("Username").fill(E2E_ADMIN_USER);
  await page.getByPlaceholder("Password").fill(E2E_ADMIN_PASS);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  await page.getByRole("button", { name: "+ New Post" }).click();
  await page.getByPlaceholder("Enter post title...").fill(postTitle);
  await page.getByPlaceholder("Write a brief introduction for this post...").fill("Automated workflow summary");
  await page.locator(".custom-editor-wrapper textarea").fill("# Automated workflow\n\nCreated by Playwright.");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  const publicDraftSearch = await request.get(`${E2E_API_URL}/search`, {
    params: { q: postTitle, scope: "posts" },
  });
  expect(publicDraftSearch.ok()).toBeTruthy();
  const draftSearchResult = await publicDraftSearch.json();
  expect(draftSearchResult.posts).toHaveLength(0);

  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  await page.getByText(postTitle, { exact: true }).click();
  await page.locator(".custom-select-trigger").first().click();
  await page.locator(".custom-select-option").filter({ hasText: "Published" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  await page.goto("/posts");
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Log Out Securely" }).click();
  await page.getByRole("button", { name: "Log Out", exact: true }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page).toHaveURL(/\/login\?redirect=%2Feditor|\/login\?redirect=\/editor/);
});

test("administrator can publish an uploaded image and safely remove it after references are cleared", async ({ page }) => {
  const unique = Date.now();
  const postTitle = `E2E image lifecycle ${unique}`;
  const imageName = `e2e-image-${unique}.png`;
  const imageAlt = `Uploaded image ${unique}`;

  await page.goto("/login");
  await page.getByPlaceholder("Username").fill(E2E_ADMIN_USER);
  await page.getByPlaceholder("Password").fill(E2E_ADMIN_PASS);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await page.getByRole("button", { name: /Files \(/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: imageName,
    mimeType: "image/png",
    buffer: onePixelPNG,
  });
  await expect(page.getByText(imageName, { exact: true })).toBeVisible();

  let fileCard = page.locator(".ai-card").filter({ hasText: imageName });
  const downloadHref = await fileCard.getByRole("link", { name: "Download" }).getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const imageViewURL = downloadHref!.replace(/\/download$/, "/view");

  await page.getByRole("button", { name: /Posts \(/ }).click();
  await page.getByRole("button", { name: "+ New Post" }).click();
  await page.getByPlaceholder("Enter post title...").fill(postTitle);
  await page.getByPlaceholder("Write a brief introduction for this post...").fill("Image lifecycle verification");
  await page.locator(".custom-editor-wrapper textarea").fill(`![${imageAlt}](${imageViewURL})`);
  await page.locator(".custom-select-trigger").first().click();
  await page.locator(".custom-select-option").filter({ hasText: "Published" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  await page.goto("/posts");
  await page.getByText(postTitle, { exact: true }).click();
  const publicImage = page.getByAltText(imageAlt);
  await expect(publicImage).toBeVisible();
  await expect.poll(async () => publicImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  await page.goto("/editor");
  await page.getByRole("button", { name: /Files \(/ }).click();
  fileCard = page.locator(".ai-card").filter({ hasText: imageName });
  await expect(fileCard).toBeVisible();
  let fileListReloads = 0;
  let protectedDeleteRequests = 0;
  page.on("request", (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (request.method() === "GET" && requestPath === "/api/admin/files") {
      fileListReloads += 1;
    }
    if (request.method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(requestPath)) {
      protectedDeleteRequests += 1;
    }
  });
  await page.route(/\/api\/admin\/files\/\d+$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "storage_error", error: "Temporary storage failure" }),
    });
  }, { times: 1 });
  await fileCard.getByRole("button", { name: "Delete" }).click();
  let deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  let deletionPanel = page.getByRole("heading", { name: "Confirm Deletion" }).locator("..");
  await deletionPanel.getByRole("button", { name: "Delete", exact: true }).click();
  let deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(503);
  await expect(deletionPanel.getByRole("alert")).toContainText("Temporary storage failure");
  const retryDeleteButton = deletionPanel.getByRole("button").last();
  await expect(retryDeleteButton).toBeEnabled();
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(1);

  deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  await retryDeleteButton.click();
  deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(409);
  expect(await deleteResponse.json()).toMatchObject({ code: "file_in_use" });
  await expect(deletionPanel.getByRole("alert")).toContainText("referenced by article content or settings");
  await expect(page.getByText(imageName, { exact: true })).toBeVisible();
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(2);

  const stablePanelHeight = (await deletionPanel.boundingBox())!.height;
  await expect(retryDeleteButton).toBeDisabled();
  await retryDeleteButton.evaluate((button: HTMLButtonElement) => button.click());
  await expect(retryDeleteButton).toHaveText("Delete");
  await expect(deletionPanel.getByRole("alert")).toContainText("referenced by article content or settings");
  expect((await deletionPanel.boundingBox())!.height).toBeCloseTo(stablePanelHeight, 1);
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(2);
  await deletionPanel.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: /Posts \(/ }).click();
  const postCard = page.locator(".ai-card").filter({ hasText: postTitle });
  await postCard.getByRole("button", { name: "Edit" }).click();
  await page.locator(".custom-editor-wrapper textarea").fill("# Image reference removed");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Files \(/ })).toBeVisible();

  await page.getByRole("button", { name: /Files \(/ }).click();
  fileCard = page.locator(".ai-card").filter({ hasText: imageName });
  await fileCard.getByRole("button", { name: "Delete" }).click();
  deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  deletionPanel = page.getByRole("heading", { name: "Confirm Deletion" }).locator("..");
  await deletionPanel.getByRole("button", { name: "Delete", exact: true }).click();
  deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  await expect(page.getByText(imageName, { exact: true })).toHaveCount(0);
});
