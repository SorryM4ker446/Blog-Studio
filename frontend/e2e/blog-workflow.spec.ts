import { expect, test } from "@playwright/test";
import {
  E2E_ADMIN_PASS,
  E2E_ADMIN_USER,
  E2E_API_URL,
} from "./support/test-env";

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
