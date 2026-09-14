import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";
import { createArticle } from "./support/articles";

async function login(page: Page) {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  expect((await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  })).ok()).toBeTruthy();
  return { "X-CSRF-Token": (await (await page.request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token };
}

async function holdHydration(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async route => {
    await gate;
    await route.continue();
  });
  return release;
}

test("article refresh keeps its source highlight before and after hydration", async ({ page }) => {
  const headers = await login(page);
  const title = `Silent refresh source ${Date.now()}`;
  const categoryResponse = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name: title } });
  expect(categoryResponse.ok()).toBeTruthy();
  const category = await categoryResponse.json();
  const post = await (await createArticle(page.request, { headers, data: {
    title, content: "Article for source restoration.", status: "published", category_id: category.id,
  } })).json();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    for (const source of ["/editor", "/search", "/", "/posts", `/posts?category=${category.id}`]) {
      await page.goto(source === "/editor" ? `/editor?tab=posts&q=${encodeURIComponent(title)}`
        : source === "/search" ? `/search?q=${encodeURIComponent(title)}` : source);
      if (source.startsWith("/posts?")) {
        const toggle = page.locator("aside.sidebar").getByRole("button", { name: "Toggle categories" });
        await toggle.click();
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
      }
      if (source === "/editor") await page.getByRole("button", { name: `Open ${title}`, exact: true }).click();
      else await page.locator(`a[href="/posts/${post.id}"]`).first().click();
      await expect(page).toHaveURL(url => url.pathname === `/posts/${post.id}`);
      const sidebar = page.locator("aside.sidebar");
      const selected = sidebar.locator(`[data-sidebar-section="${source}"]`);
      const color = await selected.evaluate(node => getComputedStyle(node).backgroundColor);
      const release = await holdHydration(page);
      try {
        await page.reload({ waitUntil: "commit" });
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-initial-sidebar", source);
        await expect(selected).toBeVisible();
        await expect(selected).toHaveCSS("background-color", color);
        if (source !== "/posts") await expect(sidebar.locator('[data-sidebar-section="/posts"]')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      } finally { release(); }
      await expect(page.locator("html")).not.toHaveAttribute("data-initial-sidebar");
      await expect(selected).toHaveCSS("background-color", color);
      await page.unrouteAll({ behavior: "wait" });
    }
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
  }
});

test("editor refresh preserves a short page's reserved height and scroll before hydration", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  const headers = await login(page);
  const query = `Silent layout ${Date.now()}`;
  const ids: number[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    for (let index = 0; index < 11; index++) {
      const post = await (await createArticle(page.request, { headers, data: {
        title: `${query} ${index}`, content: "Layout restoration fixture.", category_id: 0,
      } })).json();
      ids.push(post.id);
    }
    await page.goto(`/editor?tab=posts&q=${encodeURIComponent(query)}`);
    await expect(page.locator(".editor-post-card")).toHaveCount(10);
    const viewport = page.locator("[data-list-layout]");
    const fullHeight = (await viewport.boundingBox())!.height;
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator(".editor-post-card")).toHaveCount(1);
    const currentPage = page.getByRole("button", { name: "Page 2, current page" });
    await expect(currentPage).toBeVisible();
    await expect.poll(() => viewport.evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === "running").length)).toBe(0);
    expect((await viewport.boundingBox())!.height).toBeCloseTo(fullHeight, 0);
    await page.locator(".content-scroll").evaluate(node => { node.scrollTop = 120; });
    const before = await currentPage.boundingBox();
    const release = await holdHydration(page);
    try {
      await page.reload({ waitUntil: "commit" });
      await expect(page.locator(".editor-post-card")).toHaveCount(1);
      await expect(currentPage).toBeVisible();
      expect((await viewport.boundingBox())!.height).toBeCloseTo(fullHeight, 0);
      expect((await currentPage.boundingBox())!.y).toBeCloseTo(before!.y, 0);
      await expect(page.locator(".content-scroll")).toHaveJSProperty("scrollTop", 120);
      await expect(page.locator(".route-transition-frame")).not.toHaveClass(/route-transition-active/);
    } finally { release(); }
    await expect.poll(() => viewport.evaluate(node => Number.parseFloat(getComputedStyle(node).minHeight) || 0)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Previous page" })).toBeEnabled();
    await page.unrouteAll({ behavior: "wait" });
    expect((await viewport.boundingBox())!.height).toBeCloseTo(fullHeight, 0);
    expect((await currentPage.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    const releaseNarrow = await holdHydration(page);
    try {
      await page.reload({ waitUntil: "commit" });
      await expect(page.locator(".editor-post-card")).toHaveCount(1);
      await page.setViewportSize({ width: 760, height: 900 });
      await expect.poll(() => viewport.evaluate(node => {
        const card = node.querySelector(".editor-post-card")!;
        return Math.abs(node.getBoundingClientRect().height - (card.getBoundingClientRect().height * 10 + 9 * 16));
      })).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally { releaseNarrow(); }
    await expect.poll(() => viewport.evaluate(node => Number.parseFloat(getComputedStyle(node).minHeight) || 0)).toBeGreaterThan(0);
    await page.unrouteAll({ behavior: "wait" });
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
  }
});
