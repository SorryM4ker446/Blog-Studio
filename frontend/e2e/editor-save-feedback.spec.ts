import { expect, test, type Page } from "@playwright/test";
import { loginAdmin, expectNoOverflow } from "./support/accessibility";
import { createArticle } from "./support/articles";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

async function expectFeedbackBesideLabel(page: Page, mobile: boolean) {
  const positions = await page.locator(".editor-content-heading").evaluate((heading) => {
    const label = heading.querySelector("#post-content-label")!.getBoundingClientRect();
    const message = heading.querySelector("#post-save-message")!.getBoundingClientRect();
    const row = heading.getBoundingClientRect();
    return {
      labelRight: label.right, labelBottom: label.bottom,
      messageLeft: message.left, messageRight: message.right, messageTop: message.top,
      rowRight: row.right,
    };
  });
  expect(positions.messageRight).toBeLessThanOrEqual(positions.rowRight + 1);
  if (mobile && positions.messageTop >= positions.labelBottom) return;
  expect(positions.messageLeft).toBeGreaterThanOrEqual(positions.labelRight + 7);
}

test("save feedback stays beside the Markdown label in desktop and mobile layouts", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const headers = await loginAdmin(page);
  const title = `Save feedback ${Date.now()}`;
  const created = await createArticle(page.request, { headers, data: { title, content: "Original body", status: "draft" } });
  const post = await created.json();
  try {
    await page.goto(`/editor?edit=${post.id}`);
    await expect(page.getByRole("heading", { name: `Editing: ${title}` })).toBeVisible();
    const body = page.locator(".custom-editor-wrapper textarea");
    const save = page.getByRole("button", { name: "Save", exact: true });
    const message = page.locator("#post-save-message");
    const heading = page.locator(".editor-content-heading");
    const initialHeight = (await heading.boundingBox())!.height;

    await body.fill("Edited body");
    const endpoint = `**/api/admin/posts/${post.id}`;
    await page.route(endpoint, route => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Temporary save failure" } }) : route.continue());
    await save.click();
    await expect(message).toHaveAttribute("role", "alert");
    await expect(message).toHaveAttribute("data-tone", "error");
    await expect(message).toContainText("Temporary save failure");
    await expectFeedbackBesideLabel(page, false);
    expect((await heading.boundingBox())!.height).toBe(initialHeight);
    await page.unroute(endpoint);

    await save.click();
    await expect(message).toHaveAttribute("role", "status");
    await expect(message).toHaveAttribute("data-tone", "success");
    await expect(message).toHaveText("Saved successfully!");
    await expectFeedbackBesideLabel(page, false);
    expect((await heading.boundingBox())!.height).toBe(initialHeight);
    await message.scrollIntoViewIfNeeded();
    const desktopScreenshot = testInfo.outputPath("desktop-save-feedback.png");
    await page.screenshot({ path: desktopScreenshot });
    await testInfo.attach("Desktop save feedback", { path: desktopScreenshot, contentType: "image/png" });

    await page.setViewportSize({ width: 390, height: 844 });
    await body.fill("Edited again on mobile");
    await save.click();
    await expect(message).toHaveText("Saved successfully!");
    await expectFeedbackBesideLabel(page, true);
    await expectNoOverflow(page);
    await message.scrollIntoViewIfNeeded();
    const mobileScreenshot = testInfo.outputPath("mobile-save-feedback.png");
    await page.screenshot({ path: mobileScreenshot });
    await testInfo.attach("Mobile save feedback", { path: mobileScreenshot, contentType: "image/png" });

    await page.context().addCookies([{ name: "blog_theme", value: "light", url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/theme-light/);
    await body.fill("Edited in light theme");
    await save.click();
    await expect(message).toHaveText("Saved successfully!");
    await expectFeedbackBesideLabel(page, false);
    await message.scrollIntoViewIfNeeded();
    const lightScreenshot = testInfo.outputPath("light-save-feedback.png");
    await page.screenshot({ path: lightScreenshot });
    await testInfo.attach("Light theme save feedback", { path: lightScreenshot, contentType: "image/png" });
    expect(browserErrors).toEqual([]);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
  }
});
