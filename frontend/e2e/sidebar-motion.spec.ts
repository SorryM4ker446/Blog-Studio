import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/accessibility";
import { createArticle } from "./support/articles";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`sidebar reversals and component reflow stay continuous in ${theme} mode`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await context.addCookies([
      { name: "sidebar_collapsed", value: "true", url: E2E_APP_URL },
      { name: "blog_theme", value: theme, url: E2E_APP_URL },
    ]);
    const headers = await loginAdmin(page);
    const linkIDs: number[] = [];
    try {
      for (let index = 0; index < 4; index++) {
        const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
          title: `Sidebar motion ${index}`, description: "Responsive homepage shortcut", url: `https://example.org/sidebar-${index}`,
          icon: "link", color: "blue", visible: true, request_id: crypto.randomUUID(),
        } });
        expect(response.ok()).toBeTruthy();
        linkIDs.push((await response.json()).id);
      }
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Sidebar motion 3/ })).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(async () => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const toggle = document.querySelector<HTMLButtonElement>(".sidebar-toggle")!;
      const postsLink = sidebar.querySelector('a[href="/posts"]')!;
      const logo = sidebar.querySelector(".sidebar-logo-container")!;
      const card = document.querySelector<HTMLElement>('a[href="https://example.org/sidebar-3"]')!;
      const frames: { x: number; y: number; width: number; translate: string; time: number }[] = [];
      const sample = () => {
        const rect = card.getBoundingClientRect();
        frames.push({ x: rect.x, y: rect.y, width: sidebar.getBoundingClientRect().width,
          translate: getComputedStyle(card).translate, time: performance.now() });
      };
      sample();
      toggle.click();
      const end = performance.now() + 1100;
      while (performance.now() < end) { await new Promise(requestAnimationFrame); sample(); }
      const expanded = frames.at(-1)!;
      // Reverse twice before completion; the original link/logo must survive.
      const reversals: { progress: number | null; before: number; after: number }[] = [];
      toggle.click();
      for (let index = 0; index < 2; index++) {
        await new Promise(requestAnimationFrame);
        const animation = sidebar.getAnimations().find(animation =>
          animation instanceof CSSTransition && animation.transitionProperty === "width");
        if (!animation) throw new Error("Expected an active sidebar width transition");
        animation.pause();
        animation.currentTime = Number(animation.effect!.getTiming().duration) * 0.4;
        const progress = animation.effect!.getComputedTiming().progress;
        const before = sidebar.getBoundingClientRect().width;
        toggle.click();
        await Promise.resolve();
        reversals.push({ progress, before, after: sidebar.getBoundingClientRect().width });
      }
      await new Promise(resolve => setTimeout(resolve, 1100));
      return { frames, expanded, reversals, collapsed: sidebar.getBoundingClientRect().width,
        sameNodes: postsLink === sidebar.querySelector('a[href="/posts"]') && logo === sidebar.querySelector(".sidebar-logo-container"),
        running: document.getAnimations().filter(animation => animation.playState === "running").length,
        translate: getComputedStyle(card).translate,
        hiddenInert: [...sidebar.querySelectorAll(".hide-on-collapse")].every(element => element.hasAttribute("inert")),
      };
    });
    expect(result.expanded.width).toBeCloseTo(240, 0);
    for (const reversal of result.reversals) {
      expect(reversal.progress).toBeGreaterThan(0);
      expect(reversal.progress).toBeLessThan(1);
      expect(reversal.before).toBeGreaterThan(52);
      expect(reversal.before).toBeLessThan(240);
      expect(Math.abs(reversal.after - reversal.before)).toBeLessThan(1);
    }
    expect(result.collapsed).toBeCloseTo(52, 0);
    expect(result.sameNodes).toBe(true);
    expect(result.hiddenInert).toBe(true);
    expect(result.running).toBe(0);
    expect(result.translate).toBe("none");
    // Homepage shortcuts remain a single row while their widths and positions adapt.
    expect(Math.abs(result.expanded.y - result.frames[0].y)).toBeLessThanOrEqual(1);
    const low = Math.min(result.frames[0].x, result.expanded.x);
    const high = Math.max(result.frames[0].x, result.expanded.x);
    expect(high - low).toBeGreaterThan(1);
    expect(result.frames.some(frame => frame.x > low + .5 && frame.x < high - .5)).toBe(true);
    const steps = result.frames.slice(1).map((frame, index) => {
      const previous = result.frames[index];
      return Math.hypot(frame.x - previous.x, frame.y - previous.y) * 16.67 / Math.max(16.67, frame.time - previous.time);
    });
    // Normalize delayed samples to a nominal frame to distinguish a layout jump
    // from a sampling gap while the sidebar changes the available card width.
    expect(Math.max(...steps)).toBeLessThan(300);
    await testInfo.attach("Component motion samples", { body: JSON.stringify(result), contentType: "application/json" });
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
    await testInfo.attach("Expanded sidebar", { body: await page.screenshot({ path: testInfo.outputPath("expanded-sidebar.png") }), contentType: "image/png" });
    // Route replacement while motion is active must cancel its frame loop and
    // must not carry temporary positioning into the next page.
    await page.evaluate(async () => {
      document.querySelector<HTMLButtonElement>(".sidebar-toggle")!.click();
      await new Promise(requestAnimationFrame);
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const animation = sidebar.getAnimations().find(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === "width");
      if (!animation) throw new Error("Expected sidebar motion before navigation");
      animation.pause();
      animation.currentTime = Number(animation.effect!.getTiming().duration) * 0.4;
      const width = sidebar.getBoundingClientRect().width;
      if (width <= 52 || width >= 240) throw new Error("Navigation must interrupt sidebar motion");
      document.querySelector<HTMLAnchorElement>('.nav-posts-link')!.click();
    });
    await expect(page).toHaveURL(/\/posts$/);
    await expect(page.getByRole("heading", { name: "All Posts" })).toBeVisible();
    expect(await page.locator(".content-scroll").evaluate(element => [...element.querySelectorAll<HTMLElement>("*")]
      .every(child => getComputedStyle(child).translate === "none"))).toBe(true);
    } finally {
      for (const id of linkIDs) await page.request.delete(`${E2E_API_URL}/admin/links/${id}`, { headers, data: { version: 1 } });
    }
  });
}

test("reduced motion changes sidebar layout immediately and preserves search input", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/search?q=layout");
  const field = page.getByRole("textbox").first();
  await field.fill("Unsubmitted search");
  const url = page.url();
  const toggle = page.locator(".sidebar-toggle");
  await toggle.click();
  await expect(page.locator(".sidebar")).toHaveCSS("transition-duration", "0s");
  await expect(field).toHaveValue("Unsubmitted search");
  await expect(page).toHaveURL(url);
  await toggle.click();
  expect(await page.locator(".sidebar").evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === "running").length)).toBe(0);
  expect(await page.locator(".content-scroll").evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === "running" && animation.effect instanceof KeyframeEffect
      && animation.effect.getKeyframes().some(frame => "translate" in frame)).length)).toBe(0);
});

test("sidebar toggles preserve article dimensions, scroll and unsaved editor content", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const created = await createArticle(page.request, { headers, data: {
    title: `Sidebar reading ${Date.now()}`, content: "A paragraph for reading.\n\n".repeat(120), status: "published",
  } });
  const post = await created.json();
  try {
    await page.goto(`/posts/${post.id}`);
    const body = page.locator(".post-body");
    await body.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(async () => {
      const body = document.querySelector<HTMLElement>(".post-body")!;
      const scroll = document.querySelector<HTMLElement>(".content-scroll")!;
      scroll.scrollTop = 300;
      const before = body.getBoundingClientRect();
      const samples: { width: number; height: number; scale: string; translate: string; scroll: number }[] = [];
      for (let round = 0; round < 2; round++) {
        document.querySelector<HTMLButtonElement>(".sidebar-toggle")!.click();
        const end = performance.now() + 950;
        while (performance.now() < end) {
          await new Promise(requestAnimationFrame);
          const rect = body.getBoundingClientRect();
          samples.push({ width: rect.width, height: rect.height, scale: getComputedStyle(body).scale,
            translate: getComputedStyle(body).translate, scroll: scroll.scrollTop });
        }
      }
      return { before: { width: before.width, height: before.height }, samples,
        sameNode: body === document.querySelector(".post-body") };
    });
    expect(result.sameNode).toBe(true);
    for (const sample of result.samples) {
      expect(sample.width).toBeCloseTo(result.before.width, 0);
      expect(sample.height).toBeCloseTo(result.before.height, 0);
      expect(sample.scale).toBe("none");
      expect(sample.translate).toBe("none");
      expect(sample.scroll).toBe(300);
    }
    await page.goto(`/editor?tab=posts&edit=${post.id}`);
    const field = page.getByLabel("POST TITLE");
    await field.fill("Unsaved sidebar check");
    const url = page.url();
    let writes = 0;
    page.on("request", request => { if (["POST", "PUT"].includes(request.method()) && request.url().includes("/admin/posts")) writes++; });
    const dialogs: string[] = [];
    page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    const editor = await page.evaluate(async () => {
      const elements = [".editor-detail-frame", ".editor-form-header", ".editor-form-surface", ".custom-editor-wrapper textarea"]
        .map(selector => document.querySelector<HTMLElement>(selector)!);
      const scroll = document.querySelector<HTMLElement>(".content-scroll")!;
      scroll.scrollTop = 140;
      const before = elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
      const xs: number[] = [];
      let stable = true;
      for (let round = 0; round < 2; round++) {
        document.querySelector<HTMLButtonElement>(".sidebar-toggle")!.click();
        const end = performance.now() + 900;
        while (performance.now() < end) {
          await new Promise(requestAnimationFrame);
          elements.forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            if (Math.abs(rect.width - before[index].width) > .5 || Math.abs(rect.height - before[index].height) > .5) stable = false;
          });
          if (scroll.scrollTop !== 140) stable = false;
          xs.push(elements[0].getBoundingClientRect().x);
        }
      }
      return { stable, displacement: Math.max(...xs) - Math.min(...xs) };
    });
    expect(editor.stable).toBe(true);
    expect(editor.displacement).toBeGreaterThan(50);
    await expect(field).toHaveValue("Unsaved sidebar check");
    await expect(page).toHaveURL(url);
    expect(dialogs).toEqual([]);
    expect(writes).toBe(0);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
  }
});
