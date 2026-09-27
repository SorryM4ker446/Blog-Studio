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
        request_id: randomUUID(), title: `${prefix}-${i}`, description: "A long description for the link list view.",
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
    const firstRow = rows.first();
    const more = firstRow.getByRole("button", { name: /More actions for/ });
    const normalBackground = await firstRow.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(await firstRow.evaluate(node => getComputedStyle(node, "::after").opacity)).toBe("0");
    await more.click();
    const menu = firstRow.getByRole("group", { name: /Actions for/ });
    await expect(menu).toHaveCSS("opacity", "1");
    expect(await menu.evaluate(node => getComputedStyle(node).transitionDuration)).toContain("0.16s");
    await page.getByRole("heading", { name: "Content Editor" }).hover();
    await expect.poll(() => firstRow.evaluate(node => getComputedStyle(node, "::after").opacity)).toBe("1");
    expect(await firstRow.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(normalBackground);
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-menu-desktop.png") });
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(firstRow.locator('[role="group"]')).toHaveCSS("visibility", "hidden");
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
        const rowHeight = grid.firstElementChild!.getBoundingClientRect().height;
        const headerHeight = node.querySelector('[aria-hidden="true"]')!.getBoundingClientRect().height;
        return Math.abs(node.getBoundingClientRect().height - (8 * rowHeight + headerHeight));
      })).toBeLessThan(1);
      expect(await rows.first().evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const gap = await page.getByRole("navigation", { name: "Pagination" }).evaluate(node => {
        const viewport = document.querySelector('[data-editor-layout="links"] [data-list-layout]')!;
        return node.getBoundingClientRect().top - viewport.getBoundingClientRect().bottom;
      });
      expect(gap).toBeCloseTo(32, 0);
      await expectNoOverflow(page);
      if (width === 375) {
        await page.locator(".content-scroll").evaluate(node => node.scrollTo(0, 0));
        await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-compact-mobile.png") });
        await rows.first().getByRole("button", { name: /More actions for/ }).click();
        const mobileMenu = rows.first().getByRole("group", { name: /Actions for/ });
        await expect(mobileMenu).toBeVisible();
        const menuBox = (await mobileMenu.boundingBox())!;
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(375);
        await expectNoOverflow(page);
        await page.keyboard.press("Escape");
      }
    }
    await page.goto(`${url}-9`);
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
    expect(await viewport.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(await rows.first().evaluate(node => node.getBoundingClientRect().height) + await page.locator('[data-editor-links-list] > [aria-hidden="true"]').evaluate(node => node.getBoundingClientRect().height), 0);
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
    await rows.first().getByRole("button", { name: /More actions for/ }).click();
    await expect(rows.first().getByRole("group", { name: /Actions for/ })).toHaveCSS("opacity", "1");
    expect(await rows.first().getByRole("group", { name: /Actions for/ }).evaluate(node => getComputedStyle(node).transitionDuration)).toBe("0s");
  } finally {
    const links: HomepageLink[] = await (await page.request.get(`${E2E_API_URL}/admin/links`)).json();
    for (const link of links.filter(link => ids.includes(link.id))) {
      await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: link.version } });
    }
  }
});

test("link order numbers swap across pages and validate the requested position", async ({ page }) => {
  const headers = await loginAdmin(page);
  const ids: number[] = [];
  const prefix = `order-${randomUUID().slice(0, 8)}`;
  try {
    for (let i = 1; i <= 9; i++) {
      const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
        request_id: randomUUID(), title: `${prefix}-${i}`, description: "", url: "", icon: "link", color: "blue", visible: false,
      } });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).id);
    }
    await page.goto(`/editor?tab=links&link_q=${prefix}`);
    await expect(page.getByRole("button", { name: `Change position of ${prefix}-1, currently 1` })).toBeDisabled();
    await page.getByPlaceholder("Search links...").fill("");
    await page.getByPlaceholder("Search links...").press("Enter");
    const first = page.getByRole("article", { name: `${prefix}-1`, exact: true });
    await first.getByRole("button", { name: `Change position of ${prefix}-1, currently 1` }).click();
    const input = first.getByRole("textbox", { name: `New position for ${prefix}-1, from 1 to 9` });
    await expect(input).toBeVisible();
    expect(await input.evaluate(node => getComputedStyle(node).transitionDuration)).toContain("0.16s");
    await expect(input).toHaveCSS("outline-style", "none");
    await page.getByRole("article", { name: `${prefix}-2`, exact: true }).hover();
    await expect.poll(() => first.evaluate(node => getComputedStyle(node, "::before").opacity)).toBe("1");
    await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-order-edit.png") });
    await input.fill("10");
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("4");
    await input.press("Escape");
    await expect(first.getByRole("button", { name: `Change position of ${prefix}-1, currently 1` })).toBeVisible();
    await expect.poll(() => first.evaluate(node => getComputedStyle(node, "::before").opacity)).toBe("0");
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-1`);
    await first.getByRole("button", { name: `Change position of ${prefix}-1, currently 1` }).click();
    const confirmed = first.getByRole("textbox", { name: `New position for ${prefix}-1, from 1 to 9` });
    await confirmed.fill("9");
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = animate.call(this, frames, options);
        if (this.hasAttribute("data-link-id") && (frames as Keyframe[]).some(frame => frame.opacity === 0)) animation.pause();
        return animation;
      };
    });
    await confirmed.press("Enter");
    await expect.poll(() => first.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect(page.getByRole("article", { name: `${prefix}-9`, exact: true })).toHaveCount(0);
    expect(await first.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform)).toBe("translateX(24px)");
    await first.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    const incoming = page.getByRole("article", { name: `${prefix}-9`, exact: true });
    await expect.poll(() => incoming.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    expect(await incoming.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).toBe("translateX(-24px)");
    await incoming.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-9`);
    await expect(page.getByRole("article").last()).toHaveAttribute("aria-label", `${prefix}-8`);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-1`);
    const outgoingBack = page.getByRole("article", { name: `${prefix}-1`, exact: true });
    await outgoingBack.getByRole("button", { name: `Change position of ${prefix}-1, currently 9` }).click();
    const back = outgoingBack.getByRole("textbox", { name: `New position for ${prefix}-1, from 1 to 9` });
    await back.fill("1");
    await back.press("Enter");
    await expect.poll(() => outgoingBack.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect(page.getByRole("article", { name: `${prefix}-9`, exact: true })).toHaveCount(0);
    expect(await outgoingBack.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform)).toBe("translateX(-24px)");
    await outgoingBack.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    const incomingBack = page.getByRole("article", { name: `${prefix}-9`, exact: true });
    await expect.poll(() => incomingBack.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    expect(await incomingBack.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).toBe("translateX(24px)");
    await incomingBack.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-9`);
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-1`);
    const samePage = page.getByRole("article", { name: `${prefix}-1`, exact: true });
    const samePageTarget = page.getByRole("article", { name: `${prefix}-4`, exact: true });
    await samePage.getByRole("button", { name: `Change position of ${prefix}-1, currently 1` }).click();
    await samePage.getByRole("textbox", { name: `New position for ${prefix}-1, from 1 to 9` }).fill("4");
    await page.getByRole("heading", { name: "Content Editor" }).click();
    await expect.poll(() => samePage.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect.poll(() => samePageTarget.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-1`);
    expect(await samePage.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform)).toBe("translateY(12px)");
    expect(await samePageTarget.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform)).toBe("translateY(-12px)");
    await samePage.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await samePageTarget.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect.poll(() => samePage.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    await expect.poll(() => samePageTarget.evaluate(node => node.getAnimations().some(animation => animation.playState === "paused"))).toBe(true);
    expect(await samePage.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).toBe("translateY(-12px)");
    expect(await samePageTarget.evaluate(node => (node.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).toBe("translateY(12px)");
    await samePage.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await samePageTarget.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-4`);
    await expect(page.getByRole("article").nth(1)).toHaveAttribute("aria-label", `${prefix}-2`);
    await expect(page.getByRole("article").nth(2)).toHaveAttribute("aria-label", `${prefix}-3`);
    await expect(page.getByRole("article").nth(3)).toHaveAttribute("aria-label", `${prefix}-1`);
    await page.reload();
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-4`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = page.getByRole("article", { name: `${prefix}-4`, exact: true });
    await reduced.getByRole("button", { name: `Change position of ${prefix}-4, currently 1` }).click();
    await reduced.getByRole("textbox", { name: `New position for ${prefix}-4, from 1 to 9` }).fill("4");
    await reduced.getByRole("textbox", { name: `New position for ${prefix}-4, from 1 to 9` }).press("Enter");
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", `${prefix}-1`);
    expect(await page.getByRole("article").evaluateAll(rows => rows.flatMap(row => row.getAnimations()).length)).toBe(0);
  } finally {
    const links: HomepageLink[] = await (await page.request.get(`${E2E_API_URL}/admin/links`)).json();
    for (const link of links.filter(item => ids.includes(item.id))) {
      await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: link.version } });
    }
  }
});

test("link editor limits title and description lengths", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/editor?tab=links");
  await page.getByRole("button", { name: "New Link", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New link" });
  const title = dialog.getByLabel("TITLE", { exact: true });
  const description = dialog.getByLabel("DESCRIPTION", { exact: true });
  await expect(dialog.getByText("0/25", { exact: true })).toBeVisible();
  await expect(dialog.getByText("0/50", { exact: true })).toBeVisible();
  await title.fill("T".repeat(25));
  await title.press("X");
  await expect(title).toHaveValue("T".repeat(25));
  await expect(dialog.getByText("25/25", { exact: true })).toBeVisible();
  await title.fill("😀".repeat(25));
  await title.press("X");
  await expect(title).toHaveValue("😀".repeat(25));
  await description.fill("D".repeat(50));
  await description.press("X");
  await expect(description).toHaveValue("D".repeat(50));
  await expect(dialog.getByText("50/50", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(os.tmpdir(), "blog-links-editor-counters.png") });
});
