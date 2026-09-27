import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticle } from "./support/articles";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("post cards keep one height and reveal introductions inside the card on hover or focus", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const suffix = Date.now();
  const marker = `Introduction check ${suffix}`;
  const intro = `A longer introduction for ${marker}. `.repeat(16);
  const shortIntro = "A concise introduction.";
  const ids: number[] = [];

  try {
    for (const [title, summary] of [[`${marker} with text`, intro], [`${marker} with short text`, shortIntro], [`${marker} without text`, ""]]) {
      const response = await createArticle(page.request, { headers, data: { title, summary, content: "Test article", status: "published" } });
      ids.push((await response.json()).id);
    }

    await page.goto(`/posts?q=${encodeURIComponent(marker)}`);
    await expect(page).toHaveTitle("Blog Studio");
    const described = page.getByRole("link", { name: `${marker} with text` });
    const concise = page.getByRole("link", { name: `${marker} with short text` });
    const plain = page.getByRole("link", { name: `${marker} without text` });
    const summary = described.locator('p[id^="post-summary-"]');
    const conciseSummary = concise.locator('p[id^="post-summary-"]');
    await expect(described).toBeVisible();
    await expect(concise).toBeVisible();
    await expect(plain).toBeVisible();
    await expect(summary).toBeHidden();
    await expect(conciseSummary).toBeHidden();
    await expect(plain.locator('p[id^="post-summary-"]')).toHaveCount(0);
    const cardHeights = await Promise.all([described, concise, plain].map(link => link.locator(".ai-card").evaluate(node => node.getBoundingClientRect().height)));
    expect(Math.max(...cardHeights) - Math.min(...cardHeights)).toBeLessThan(1);
    const [plainCardBefore, plainTitleBefore, describedCardBefore, describedTitleBefore] = await Promise.all([
      plain.locator(".ai-card").boundingBox(), plain.locator("h4").boundingBox(),
      described.locator(".ai-card").boundingBox(), described.locator("h4").boundingBox(),
    ]);
    expect(plainTitleBefore!.width).toBeGreaterThan(describedTitleBefore!.width);
    expect(Math.abs((plainTitleBefore!.x - plainCardBefore!.x) - (describedTitleBefore!.x - describedCardBefore!.x))).toBeLessThan(1);
    expect(Math.abs((plainTitleBefore!.y - plainCardBefore!.y) - (describedTitleBefore!.y - describedCardBefore!.y))).toBeLessThan(1);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-inline-summary-idle.png") });
    }

    await described.hover();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveCSS("opacity", "1");
    await expect(summary).toContainText(intro);
    const label = summary.getByText("INTRODUCTION", { exact: true });
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS("font-family", /ui-monospace/);
    const [cardBox, detailsBox, summaryBox] = await Promise.all([
      described.locator(".ai-card").boundingBox(),
      described.locator("h4").boundingBox(),
      summary.boundingBox(),
    ]);
    expect(summaryBox!.x).toBeGreaterThan(detailsBox!.x + detailsBox!.width);
    expect(summaryBox!.x + summaryBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    expect(summaryBox!.y).toBeGreaterThanOrEqual(cardBox!.y);
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
    expect(Math.abs(detailsBox!.x - describedTitleBefore!.x)).toBeLessThan(1);
    expect(Math.abs(detailsBox!.y - describedTitleBefore!.y)).toBeLessThan(1);
    await expect(summary).toHaveCSS("border-left-width", "1px");
    await expect(summary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-inline-summary-desktop.png") });
    }

    await concise.hover();
    await expect(conciseSummary).toBeVisible();
    await expect(conciseSummary).toHaveCSS("opacity", "1");
    const [conciseCardBox, conciseSummaryBox] = await Promise.all([
      concise.locator(".ai-card").boundingBox(), conciseSummary.boundingBox(),
    ]);
    expect(Math.abs((summaryBox!.x - cardBox!.x) - (conciseSummaryBox!.x - conciseCardBox!.x))).toBeLessThan(1);
    expect(Math.abs((summaryBox!.y - cardBox!.y) - (conciseSummaryBox!.y - conciseCardBox!.y))).toBeLessThan(1);
    expect(Math.abs(summaryBox!.height - conciseSummaryBox!.height)).toBeLessThan(1);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-inline-summary-short.png") });
    }

    await plain.hover();
    await expect(summary).toBeHidden();
    await described.focus();
    await expect(summary).toBeVisible();

    await page.setViewportSize({ width: 375, height: 850 });
    await described.hover();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveCSS("opacity", "1");
    await expect(label).toBeHidden();
    await expect(summary.locator("span").last()).toHaveCSS("text-overflow", "ellipsis");
    const mobileHeights = await Promise.all([described, concise, plain].map(link => link.locator(".ai-card").evaluate(node => node.getBoundingClientRect().height)));
    expect(Math.max(...mobileHeights) - Math.min(...mobileHeights)).toBeLessThan(1);
    const mobileCardBox = await described.locator(".ai-card").boundingBox();
    const mobileSummaryBox = await summary.boundingBox();
    expect(mobileSummaryBox!.x).toBeGreaterThanOrEqual(mobileCardBox!.x);
    expect(mobileSummaryBox!.x + mobileSummaryBox!.width).toBeLessThanOrEqual(mobileCardBox!.x + mobileCardBox!.width);
    expect(mobileSummaryBox!.y + mobileSummaryBox!.height).toBeLessThanOrEqual(mobileCardBox!.y + mobileCardBox!.height - 4);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-inline-summary-mobile.png") });
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await expect(plain.locator(".ai-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await described.hover();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveCSS("opacity", "1");
    await expect(label).toBeVisible();
    await expect(summary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(browserErrors).toEqual([]);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-inline-summary-light.png") });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(summary).toHaveCSS("transition-duration", "0s");
  } finally {
    for (const id of ids) {
      const response = await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
      expect(response.ok()).toBeTruthy();
    }
  }
});
