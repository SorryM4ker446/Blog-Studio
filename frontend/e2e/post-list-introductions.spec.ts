import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArticle } from "./support/articles";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("post cards share one height and show introductions on hover or focus", async ({ page }) => {
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
  const ids: number[] = [];

  try {
    for (const [title, summary] of [[`${marker} with text`, intro], [`${marker} without text`, ""]]) {
      const response = await createArticle(page.request, { headers, data: { title, summary, content: "Test article", status: "published" } });
      ids.push((await response.json()).id);
    }

    await page.goto(`/posts?q=${encodeURIComponent(marker)}`);
    const described = page.getByRole("link", { name: `${marker} with text` });
    const plain = page.getByRole("link", { name: `${marker} without text` });
    await expect(described).toBeVisible();
    await expect(plain).toBeVisible();
    const describedHeight = await described.locator(".ai-card").evaluate(node => node.getBoundingClientRect().height);
    const plainHeight = await plain.locator(".ai-card").evaluate(node => node.getBoundingClientRect().height);
    expect(Math.abs(describedHeight - plainHeight)).toBeLessThan(1);

    const tooltip = described.getByRole("tooltip");
    await expect(tooltip).toBeHidden();
    await expect(plain.getByRole("tooltip")).toHaveCount(0);
    await described.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator("span").first()).toHaveText("Introduction");
    await expect(tooltip).toHaveCSS("opacity", "1");
    await expect(tooltip).toContainText(intro);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-tooltip-desktop.png") });
    }
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.getByRole("link", { name: "Posts Playground" }).hover();
    await plain.hover();
    await described.hover();
    await expect(described).toHaveAttribute("data-tooltip-placement", "above");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS("opacity", "1");
    const aboveBounds = await tooltip.boundingBox();
    const cardBounds = await described.boundingBox();
    expect(aboveBounds!.y + aboveBounds!.height).toBeLessThan(cardBounds!.y);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-tooltip-above.png") });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("link", { name: "Posts Playground" }).hover();
    await plain.hover();
    await expect(tooltip).toBeHidden();

    await described.focus();
    await expect(tooltip).toBeVisible();

    await page.setViewportSize({ width: 375, height: 850 });
    await described.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS("opacity", "1");
    const mobileHeights = await Promise.all([described, plain].map(link => link.locator(".ai-card").evaluate(node => node.getBoundingClientRect().height)));
    expect(Math.abs(mobileHeights[0] - mobileHeights[1])).toBeLessThan(1);
    const bounds = await tooltip.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(850);
    const introText = tooltip.locator("span").last();
    expect(await introText.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await introText.hover();
    await page.mouse.wheel(0, 180);
    await expect.poll(() => introText.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(tooltip).toBeVisible();
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-tooltip-mobile.png") });
    }

    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await expect(plain.locator(".ai-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await described.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS("opacity", "1");
    const colors = await tooltip.evaluate(node => {
      const sample = document.createElement("span");
      sample.style.backgroundColor = "var(--bg-surface)";
      document.body.append(sample);
      const expected = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return { actual: getComputedStyle(node).backgroundColor, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    expect(browserErrors).toEqual([]);
    if (process.env.POST_LIST_QA_SCREENSHOTS) {
      await page.screenshot({ path: join(tmpdir(), "post-list-tooltip-light.png") });
    }
  } finally {
    for (const id of ids) {
      const response = await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
      expect(response.ok()).toBeTruthy();
    }
  }
});
