import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loginAdmin, expectNoOverflow } from "./support/accessibility";
import { E2E_API_URL } from "./support/test-env";
import type { HomepageLink } from "../src/lib/links";

test("editor links reserve a full page through paging, reload and resize", async ({ page }) => {
  const headers = await loginAdmin(page);
  const ids: number[] = [];
  const prefix = `layout-${randomUUID().slice(0, 8)}`;
  try {
    for (let i = 1; i <= 9; i++) {
      const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
        request_id: randomUUID(), title: `${prefix}-${i}`, description: "A long description ".repeat(12),
        url: "https://example.com/" + "path/".repeat(25), icon: "link", color: "blue", visible: false,
      } });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).id);
    }
    const url = `/editor?tab=links&link_q=${prefix}`;
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(url);
    const rows = page.locator("[data-link-id]");
    const viewport = page.locator('[data-editor-layout="links"] [data-list-layout]');
    await expect(rows).toHaveCount(8);
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-compact-desktop.png") });
    const fullHeight = await viewport.evaluate(node => node.getBoundingClientRect().height);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(rows).toHaveCount(1);
    expect(await viewport.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(fullHeight, 0);
    for (const width of [1600, 760, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.reload();
      await expect(rows).toHaveCount(1);
      await expect.poll(() => viewport.evaluate(node => {
        const grid = node.querySelector('.editor-resource-grid')!;
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const rowHeight = grid.firstElementChild!.getBoundingClientRect().height;
        const rowCount = Math.ceil(8 / columns);
        return Math.abs(node.getBoundingClientRect().height - (rowCount * rowHeight + (rowCount - 1) * 16));
      })).toBeLessThan(1);
      expect(await rows.first().evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
      const gap = await page.getByRole("navigation", { name: "Pagination" }).evaluate(node => {
        const viewport = document.querySelector('[data-editor-layout="links"] [data-list-layout]')!;
        return node.getBoundingClientRect().top - viewport.getBoundingClientRect().bottom;
      });
      expect(gap).toBeCloseTo(32, 0);
      await expectNoOverflow(page);
      if (width === 375) await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-compact-mobile.png") });
    }
    await page.goto(`${url}-9`);
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
    expect(await viewport.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(await rows.first().evaluate(node => node.getBoundingClientRect().height), 0);
    await expect(page.getByRole("tab", { name: "Links (1)", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /^Posts/ }).click();
    await expect(page.getByRole("tab", { name: "Links (9)", exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/link_page=|link_q=/);
    await page.getByRole("tab", { name: /^Links/ }).click();
    await expect(page.getByPlaceholder("Search links...")).toHaveValue("");
    await expect(rows).toHaveCount(8);
    await expect(page.getByRole("tab", { name: "Links (9)", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("tab", { name: /^Files/ }).click();
    await page.getByRole("tab", { name: /^Links/ }).click();
    await expect(page.getByRole("button", { name: "Page 1, current page" })).toBeVisible();
    await expect(rows).toHaveCount(8);
    await expect(page).not.toHaveURL(/link_page=|link_q=/);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/editor?tab=links");
    const ordered: HomepageLink[] = await (await page.request.get(`${E2E_API_URL}/admin/links`)).json();
    const last = ordered[7], first = ordered[8];
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = original.call(this, frames, options);
        if (this.hasAttribute("data-link-id") && (frames as Keyframe[]).some(frame => frame.opacity === 0)) animation.pause();
        return animation;
      };
    });
    for (const [action, direction, destination] of [["later", 1, first], ["earlier", -1, first]] as const) {
      if (action === "earlier") {
        await page.getByRole("button", { name: "Next page" }).click();
        await expect(page.locator(`[data-link-id="${last.id}"]`)).toBeVisible();
      }
      const outgoing = page.locator(`[data-link-id="${last.id}"]`);
      const incoming = page.locator(`[data-link-id="${destination.id}"]`);
      await outgoing.getByRole("button", { name: `Move ${last.title} ${action}`, exact: true }).click();
      await expect.poll(() => outgoing.evaluate(node => node.getAnimations().some(a => a.playState === "paused"))).toBe(true);
      await expect(incoming).toHaveCount(0);
      expect(await outgoing.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform)).toBe(`translateX(${direction * 18}px)`);
      const height = await viewport.evaluate(node => node.getBoundingClientRect().height);
      await outgoing.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
      await expect(outgoing).toHaveCount(0);
      await expect(incoming).toHaveCount(1);
      await expect.poll(() => incoming.evaluate(node => node.getAnimations().some(a => a.playState === "paused"))).toBe(true);
      expect(await incoming.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).toBe(`translateX(${-direction * 18}px)`);
      expect(await viewport.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(height, 0);
      await incoming.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
      await expect(incoming).toHaveCSS("opacity", "1");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(`[data-link-id="${first.id}"]`).getByRole("button", { name: `Move ${first.title} earlier`, exact: true }).click();
    await expect(page.locator(`[data-link-id="${last.id}"]`)).toBeVisible();
    expect(await rows.evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
  } finally {
    const links: HomepageLink[] = await (await page.request.get(`${E2E_API_URL}/admin/links`)).json();
    for (const link of links.filter(link => ids.includes(link.id))) {
      await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: link.version } });
    }
  }
});
