import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";
import { createArticle } from "./support/articles";
import { writeFile } from "node:fs/promises";

const query = `Navigation stability ${Date.now()}`;
const ids: number[] = [];
const fileIds: number[] = [];
let fixture: APIRequestContext;
let headers: Record<string, string>;

async function login(page: Page) {
  const token = (await (await page.request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token;
  expect((await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": token }, data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  })).ok()).toBeTruthy();
}

test.beforeAll(async ({ playwright }) => {
  fixture = await playwright.request.newContext();
  const request = fixture;
  const token = (await (await request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token;
  expect((await request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": token }, data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  })).ok()).toBeTruthy();
  headers = { "X-CSRF-Token": (await (await request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token };
  for (let offset = 0; offset < 991; offset += 20) {
    await Promise.all(Array.from({ length: Math.min(20, 991 - offset) }, async (_, index) => {
      const response = await createArticle(request, { headers, data: {
        title: `${query} ${offset + index}`, summary: "A reproducible list entry.",
        content: "Real article for deep-page navigation.", status: "published", category_id: 0,
      } });
      ids.push((await response.json()).id);
      const file = await request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
        file: { name: `navigation-${offset + index}.txt`, mimeType: "text/plain", buffer: Buffer.from("Navigation fixture") },
        display_name: `${query} file ${offset + index}`, description: "A file with reproducible metadata.",
      } });
      expect(file.status()).toBe(201);
      fileIds.push((await file.json()).id);
    }));
  }
});

test.afterAll(async () => {
  for (const [kind, records] of [["posts", ids], ["files", fileIds]] as const) {
    for (let offset = 0; offset < records.length; offset += 20) {
      await Promise.all(records.slice(offset, offset + 20).map(async id => {
        expect((await fixture.delete(`${E2E_API_URL}/admin/${kind}/${id}`, { headers })).ok()).toBeTruthy();
      }));
    }
  }
  await fixture.dispose();
});

for (const resource of ["posts", "files"] as const) {
  test(`first entry to a short hundredth ${resource} page stays stable through hydration`, async ({ page }, testInfo) => {
    await login(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      const frames: { page: string | null; height: number; scroll: number }[] = [];
      Object.assign(window, { hydrationFrames: frames });
      const sample = () => {
        const result = document.querySelector("[data-result-page]");
        if (result) frames.push({ page: result.getAttribute("data-result-page"), height: result.parentElement!.getBoundingClientRect().height, scroll: document.querySelector(".content-scroll")!.scrollTop });
        if (frames.length < 600) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async route => { await gate; await route.continue(); });
    let serverHeight = 0;
    try {
      await page.goto(`/editor?tab=${resource}&q=${encodeURIComponent(query)}&${resource === "posts" ? "post_page" : "file_page"}=100`, { waitUntil: "commit" });
      const cards = page.locator(resource === "posts" ? ".editor-post-card" : "[data-file-id]");
      await expect(cards).toHaveCount(1);
      const card = await cards.boundingBox();
      serverHeight = await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height);
      expect(serverHeight).toBeGreaterThan(card!.height * 3);
      await expect(page.getByRole("button", { name: "Page 100, current page" })).toBeAttached();
    } finally { release(); }
    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await expect(page.getByRole("button", { name: "Switch to Dark Mode" })).toBeVisible();
    expect(await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(serverHeight, 0);
    const frames = await page.evaluate(() => (window as unknown as { hydrationFrames: { page: string; height: number }[] }).hydrationFrames);
    expect(frames.length).toBeGreaterThan(1);
    expect(new Set(frames.map(frame => frame.page))).toEqual(new Set(["100"]));
    expect(Math.max(...frames.map(frame => frame.height)) - Math.min(...frames.map(frame => frame.height))).toBeLessThan(1);
    expect(errors).toEqual([]);
    await testInfo.attach("hydration-frames", { body: JSON.stringify(frames), contentType: "application/json" });
    await writeFile(testInfo.outputPath("hydration-frames.json"), JSON.stringify(frames));
    await page.screenshot({ path: testInfo.outputPath("deep-page.png"), animations: "disabled" });
    await expect(page.locator(".route-transition-frame")).not.toHaveClass(/route-transition-active/);
  });
}

test("expired snapshots preserve the target page and editor geometry throughout return", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/editor?tab=posts&q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "Go to page 100", exact: true }).click();
  await expect(page.locator(".editor-post-card")).toHaveCount(1);
  const viewport = page.locator("[data-result-page]").locator("..");
  const height = (await viewport.boundingBox())!.height;
  await page.getByRole("button", { name: /^Open Navigation stability/ }).click();
  await expect(page.locator(".post-body")).toBeVisible();
  await page.clock.install();
  await page.clock.setSystemTime(Date.now() + 6 * 60_000);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/search?**", async route => { await gate; await route.continue(); });
  try {
    await page.goBack();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.locator('[data-result-page="1"]')).toHaveCount(0);
    await expect(page.locator('[data-result-page="100"]')).toHaveCount(1);
    expect((await viewport.boundingBox())!.height).toBeCloseTo(height, 0);
  } finally { release(); }
});

for (const resource of ["posts", "files"] as const) {
  test(`${resource} deep editor pages reserve deterministic rows with storage unavailable`, async ({ page }) => {
    await login(page);
    await page.addInitScript(() => {
      for (const method of ["getItem", "setItem", "removeItem"] as const) Storage.prototype[method] = () => { throw new DOMException("blocked", "SecurityError"); };
    });
    for (const width of [1600, 375]) {
      await page.setViewportSize({ width, height: 900 });
      let fullHeight = 0;
      for (const number of [7, 50, 100]) {
        await page.goto(`/editor?tab=${resource}&q=${encodeURIComponent(query)}&${resource === "posts" ? "post_page" : "file_page"}=${number}`);
        const cards = page.locator(resource === "posts" ? ".editor-post-card" : "[data-file-id]");
        await expect(cards).toHaveCount(number === 100 ? 1 : 10);
        await expect(page.getByRole("button", { name: `Page ${number}, current page` })).toBeAttached();
        const height = await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height);
        if (!fullHeight) fullHeight = height;
        expect(height).toBeCloseTo(fullHeight, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  });
}

for (const route of ["/editor", "/posts"]) {
  test(`${route} survives fifty detail round trips without restoring another page or replaying pagination`, async ({ page }, testInfo) => {
    await login(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const pageKey = route === "/editor" ? "post_page" : "page";
    await page.goto(`${route}?q=${encodeURIComponent(query)}&${pageKey}=50`);
    await expect(page.locator('[data-result-page="50"]')).toBeAttached();
    await page.evaluate(() => {
      const records = { pages: [] as number[], heights: [] as number[], paginationAnimations: 0, routeAnimations: 0, stop: false };
      Object.assign(window, { stabilityRecords: records });
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.hasAttribute("data-result-page")) records.paginationAnimations++;
        return original.call(this, frames, options);
      };
      document.addEventListener("animationstart", event => {
        if ((event.target as Element).classList.contains("route-transition-frame")) records.routeAnimations++;
      });
      const sample = () => {
        const result = document.querySelector("[data-result-page]");
        if (result) {
          records.pages.push(Number(result.getAttribute("data-result-page")));
          records.heights.push(result.parentElement!.getBoundingClientRect().height);
        }
        if (!records.stop) requestAnimationFrame(sample);
      };
      sample();
    });
    for (let visit = 0; visit < 50; visit++) {
      const result = page.locator('[data-result-page="50"]');
      if (route === "/editor") await result.getByRole("button", { name: /^Open / }).nth(visit % 10).click();
      else await result.locator('a[href^="/posts/"]').nth(visit % 10).click();
      await expect(page.locator(".post-body")).toBeVisible();
      await page.goBack();
      await expect(page.locator('[data-result-page="50"]')).toBeAttached();
      await expect(page.getByRole("button", { name: "Page 50, current page" })).toBeAttached();
    }
    const records = await page.evaluate(() => {
      const records = (window as unknown as { stabilityRecords: { pages: number[]; heights: number[]; paginationAnimations: number; routeAnimations: number; stop: boolean } }).stabilityRecords;
      records.stop = true;
      return records;
    });
    expect(new Set(records.pages)).toEqual(new Set([50]));
    expect(records.paginationAnimations).toBe(0);
    expect(records.routeAnimations).toBeLessThanOrEqual(100);
    expect(Math.max(...records.heights) - Math.min(...records.heights)).toBeLessThan(1);
    await testInfo.attach("navigation-frames", { body: JSON.stringify(records), contentType: "application/json" });
    await writeFile(testInfo.outputPath("navigation-frames.json"), JSON.stringify(records));
  });
}

test("twenty-five distinct list keys can evict snapshots without losing an early history target", async ({ page }) => {
  await login(page);
  await page.goto(`/editor?tab=posts&q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "Go to page 100", exact: true }).click();
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
  const height = await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height);
  for (let index = 0; index < 25; index++) {
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.locator(`[data-result-page="${99 - index}"]`)).toBeAttached();
  }
  await page.evaluate(() => history.go(-25));
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
  await page.getByRole("button", { name: /^Open / }).click();
  await expect(page.locator(".post-body")).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
  expect(await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(height, 0);
});

test("cold return errors keep the target layout and retry without reviving old rows", async ({ page }) => {
  await login(page);
  await page.goto(`/editor?tab=posts&q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "Go to page 100", exact: true }).click();
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
  const height = await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height);
  await page.getByRole("button", { name: /^Open / }).click();
  await expect(page.locator(".post-body")).toBeVisible();
  await page.clock.install();
  await page.clock.setSystemTime(Date.now() + 6 * 60_000);
  await page.route("**/api/admin/search?**", route => route.fulfill({ status: 503, json: { error: "List temporarily unavailable", code: "unavailable" } }), { times: 1 });
  await page.goBack();
  await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText("List temporarily unavailable");
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
  await expect(page.locator(".editor-post-card")).toHaveCount(0);
  expect(await page.locator("[data-list-layout]").evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(height, 0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".editor-post-card")).toHaveCount(1);
  await expect(page.locator('[data-result-page="100"]')).toBeAttached();
});

test("identical URLs retain different history offsets when storage is blocked", async ({ page }) => {
  await login(page);
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) Storage.prototype[method] = () => { throw new Error("blocked"); };
  });
  await page.goto(`/editor?tab=posts&q=${encodeURIComponent(query)}&post_page=7`);
  const scroll = page.locator(".content-scroll");
  await expect(page.locator('[data-result-page="7"]')).toBeAttached();
  await scroll.evaluate(node => { node.scrollTop = 120; });
  await expect.poll(() => page.evaluate(() => history.state.blogNavigation.scroll)).toBe(120);
  const first = await page.evaluate(() => history.state.blogNavigation.id);
  await page.evaluate(() => history.pushState(null, "", location.href));
  expect(await page.evaluate(() => history.state.blogNavigation.id)).not.toBe(first);
  await scroll.evaluate(node => { node.scrollTop = 260; });
  await expect.poll(() => page.evaluate(() => history.state.blogNavigation.scroll)).toBe(260);
  await page.goBack();
  await expect(scroll).toHaveJSProperty("scrollTop", 120);
  await page.goForward();
  await expect(scroll).toHaveJSProperty("scrollTop", 260);
});

