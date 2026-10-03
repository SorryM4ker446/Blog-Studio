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

test("save feedback enters beside the Markdown label and exits smoothly on desktop and mobile", async ({ page }, testInfo) => {
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
    await expect(message).toHaveCSS("animation-name", "editorSaveFeedbackIn");
    await expect(message).toHaveCSS("border-top-style", "none");
    await expect(message).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expectFeedbackBesideLabel(page, false);
    expect((await heading.boundingBox())!.height).toBe(initialHeight);
    await message.scrollIntoViewIfNeeded();
    const desktopScreenshot = testInfo.outputPath("desktop-save-feedback.png");
    await page.screenshot({ path: desktopScreenshot });
    await testInfo.attach("Desktop save feedback", { path: desktopScreenshot, contentType: "image/png" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const slot = document.querySelector<HTMLElement>(".editor-save-feedback-slot")!;
      const observed = window as typeof window & { feedbackExit?: string[] };
      observed.feedbackExit = [];
      new MutationObserver(() => {
        const badge = slot.querySelector<HTMLElement>("#post-save-message");
        observed.feedbackExit?.push(`${slot.dataset.visible}:${badge ? getComputedStyle(badge).animationName : "removed"}`);
      }).observe(slot, { attributes: true, attributeFilter: ["data-visible"] });
    });
    await body.fill("Edited again on mobile");
    await expect.poll(() => page.evaluate(() => (window as typeof window & { feedbackExit?: string[] }).feedbackExit || []))
      .toContain("false:editorSaveFeedbackOut");
    await save.click();
    await expect(message).toHaveText("Saved successfully!");
    await expectFeedbackBesideLabel(page, true);
    await expectNoOverflow(page);
    await page.locator(".editor-save-feedback-slot").evaluate(element => Promise.all(
      element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
    const mobileHeights = await page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>(".editor-content-heading")!;
      const heights = [heading.getBoundingClientRect().height];
      const observer = new ResizeObserver(() => heights.push(heading.getBoundingClientRect().height));
      observer.observe(heading);
      (window as typeof window & { finishFeedbackCollapse?: () => number[] }).finishFeedbackCollapse = () => {
        observer.disconnect();
        return heights;
      };
      return heights;
    });
    expect(mobileHeights.length).toBeGreaterThan(0);
    await body.fill("Unsaved mobile changes");
    await expect(message).toHaveCount(0);
    const heights = await page.evaluate(() => (window as typeof window & { finishFeedbackCollapse?: () => number[] }).finishFeedbackCollapse?.() || []);
    expect(heights[0] - heights.at(-1)!).toBeGreaterThan(15);
    expect(Math.max(...heights.slice(1).map((height, index) => Math.abs(height - heights[index])))).toBeLessThan(18);
    await save.click();
    await expect(message).toHaveText("Saved successfully!");
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(message).toHaveCSS("animation-name", "none");
    await body.fill("Edited with reduced motion");
    await expect(message).toHaveCount(0);
    await save.click();
    await expect(message).toHaveCSS("animation-name", "none");
    expect(browserErrors).toEqual([]);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
  }
});
