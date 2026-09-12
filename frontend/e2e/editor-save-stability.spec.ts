import { createArticle } from "./support/articles";
import { expect, test, type Locator, type TestInfo } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL, E2E_APP_URL } from "./support/test-env";

async function presentation(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { opacity: style.opacity, background: style.backgroundColor, color: style.color,
      x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

interface MonitoredSidebar extends HTMLElement {
  finishStabilityCheck?: () => string[];
}

async function monitorSidebar(sidebar: Locator) {
  await expect.poll(() => sidebar.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === "running" || animation.pending).length)).toBe(0);
  await sidebar.evaluate(element => {
    const tracked = [element, ...element.querySelectorAll(
      ".nav-item, .nav-posts-row, .sidebar-categories, .sidebar-categories-inner, .sidebar-category-link",
    )];
    const problems = new Set<string>();
    let frame = 0;
    const check = () => {
      for (const node of tracked) {
        const label = node.className;
        if (!node.isConnected || !element.contains(node)) {
          problems.add(`${label}: original node detached`);
          continue;
        }
        const style = getComputedStyle(node);
        if (style.opacity !== "1" || style.visibility !== "visible" || style.display === "none") {
          problems.add(`${label}: opacity=${style.opacity}, visibility=${style.visibility}, display=${style.display}`);
        }
      }
    };
    const tick = () => { check(); frame = requestAnimationFrame(tick); };
    tick();
    (element as MonitoredSidebar).finishStabilityCheck = () => {
      cancelAnimationFrame(frame);
      check();
      return [...problems];
    };
  });
}

async function sidebarPresentation(sidebar: Locator) {
  return sidebar.evaluate(element => [element, ...element.querySelectorAll(
    ".nav-item, .nav-posts-row, .sidebar-categories, .sidebar-category-link, .sidebar-category-name, .sidebar-category-count",
  )].map(node => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return { text: node.textContent, opacity: style.opacity, visibility: style.visibility,
      background: style.backgroundColor, color: style.color, transform: style.transform,
      x: box.x, y: box.y, width: box.width, height: box.height };
  }));
}

async function attachSidebar(sidebar: Locator, testInfo: TestInfo, name: string) {
  await testInfo.attach(`Sidebar ${name}`, { body: await sidebar.screenshot(), contentType: "image/png" });
}

test("sidebar stability checks detect a transient fade and replaced navigation nodes", async ({ page }) => {
  await page.setContent('<nav><a class="nav-item" href="/editor">Content Editor</a></nav>');
  const sidebar = page.locator("nav");
  const before = await sidebarPresentation(sidebar);
  await monitorSidebar(sidebar);
  await sidebar.evaluate(async element => {
    const node = element as HTMLElement;
    node.style.opacity = "0.5";
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    node.style.opacity = "1";
  });
  expect(await sidebarPresentation(sidebar)).toEqual(before);
  expect(await sidebar.evaluate(element => (element as MonitoredSidebar).finishStabilityCheck?.()))
    .toEqual([expect.stringContaining("opacity=0.5")]);

  await monitorSidebar(sidebar);
  await sidebar.locator("a").evaluate(element => element.replaceWith(element.cloneNode(true)));
  expect(await sidebarPresentation(sidebar)).toEqual(before);
  expect(await sidebar.evaluate(element => (element as MonitoredSidebar).finishStabilityCheck?.()))
    .toEqual(["nav-item: original node detached"]);
});

for (const theme of ["dark", "light"]) {
  test(`saving preserves the ${theme} editor presentation and prevents edits until completion`, async ({ page }, testInfo) => {
    const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
    const login = await page.request.post(`${E2E_API_URL}/login`, {
      headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
      data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
    });
    expect(login.ok()).toBeTruthy();
    const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
    await page.context().addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    const name = `Save stability ${theme} ${Date.now()}`;
    const createdCategory = await page.request.post(`${E2E_API_URL}/admin/categories`, { headers, data: { name } });
    expect(createdCategory.ok()).toBeTruthy();
    const category = await createdCategory.json();
    const posts: { id: number; title: string }[] = [];
    const sidebar = page.locator(".sidebar .nav-menu");
    let release = () => {};
    try {
      for (const [suffix, status] of [["anchor", "published"], ["A", "draft"], ["B", "draft"]]) {
        const response = await createArticle(page.request, {
          headers, data: { title: `${name} ${suffix}`, content: `Body ${suffix}`, status, category_id: category.id },
        });
        expect(response.ok()).toBeTruthy();
        posts.push(await response.json());
      }
      const [, articleA, articleB] = posts;
      await page.goto(`/editor?q=${encodeURIComponent(name)}`);
      const toggle = page.getByRole("button", { name: "Toggle categories" });
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      const more = page.locator(".sidebar-categories-more");
      if (await more.isVisible() && await more.textContent() === "More") await more.click();
      await page.getByRole("button", { name: `Open ${articleA.title}`, exact: true }).click();
      const body = page.locator(".custom-editor-wrapper textarea");
      await body.fill("Preserved submitted body");
      const save = page.locator(".editor-save-button");
      const status = page.locator(".editor-publication-status");
      const categoryControl = page.getByRole("combobox", { name: "Post category" });
      await expect(save).toHaveAccessibleName("Save");
      await categoryControl.click();
      await expect(page.getByRole("listbox", { name: "Post category" })).toHaveCSS("opacity", "1");
      const controlsScreenshot = testInfo.outputPath(`editor-controls-${theme}.png`);
      await page.screenshot({ path: controlsScreenshot });
      await testInfo.attach(`Editor controls (${theme})`, { path: controlsScreenshot, contentType: "image/png" });
      await categoryControl.press("Escape");
      await save.scrollIntoViewIfNeeded();
      await expect(sidebar.getByRole("link", { name: `${name} 1`, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await monitorSidebar(sidebar);
      const beforeSidebar = await sidebarPresentation(sidebar);
      await attachSidebar(sidebar, testInfo, "before saving");
      const beforeSave = await presentation(save);
      const beforeStatus = await presentation(status);
      const gate = new Promise<void>(resolve => { release = resolve; });
      const endpoint = `**/api/admin/posts/${articleA.id}`;
      await page.route(endpoint, async route => {
        if (route.request().method() !== "PUT") return route.continue();
        await gate;
        await route.fulfill({ status: 503, json: { error: "Temporary save failure" } });
      });
      await save.click();
      await expect(save).toBeDisabled();
      await expect(save).toHaveAccessibleName("Save");
      await expect(page.getByRole("button", { name: "Back to content list" })).toBeDisabled();
      await expect(page.locator("#post-title")).toBeDisabled();
      await expect(page.locator("#post-summary")).toBeDisabled();
      await expect(body).toBeDisabled();
      await expect(page.getByRole("combobox", { name: "Post category" })).toBeDisabled();
      expect(await presentation(save)).toEqual(beforeSave);
      expect(await presentation(status)).toEqual(beforeStatus);
      await attachSidebar(sidebar, testInfo, "during failed save");
      expect(await sidebarPresentation(sidebar)).toEqual(beforeSidebar);
      release();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "alert");
      await expect(save).toBeEnabled();
      await expect(body).toHaveValue("Preserved submitted body");
      await attachSidebar(sidebar, testInfo, "after failed save");
      expect(await sidebarPresentation(sidebar)).toEqual(beforeSidebar);
      await page.unroute(endpoint);

      await sidebar.evaluate(element => element.setAttribute("data-preserved", "yes"));
      const publishGate = new Promise<void>(resolve => { release = resolve; });
      await page.route(`${endpoint}/publish`, async route => {
        if (route.request().method() !== "POST") return route.continue();
        await publishGate;
        await route.continue();
      });
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(body).toBeDisabled();
      await expect(page.getByRole("button", { name: "Back to content list" })).toBeDisabled();
      await page.keyboard.type("Must not replace submitted content");
      await expect(body).toHaveValue("Preserved submitted body");
      await attachSidebar(sidebar, testInfo, "during publishing");
      expect(await sidebarPresentation(sidebar)).toEqual(beforeSidebar);
      release();
      await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
      await page.unroute(`${endpoint}/publish`);
      await expect(sidebar).toHaveAttribute("data-preserved", "yes");
      await expect(sidebar.getByRole("link", { name: `${name} 2`, exact: true })).toBeVisible();
      const detail = await page.request.get(`${E2E_API_URL}/admin/posts/${articleA.id}`);
      expect(await detail.json()).toMatchObject({ content: "Preserved submitted body", status: "published" });

      await page.getByRole("button", { name: `Open ${articleB.title}`, exact: true }).click();
      await body.fill("Body belonging to B");
      await save.click();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "status");
      const savedB = await page.request.get(`${E2E_API_URL}/admin/posts/${articleB.id}`);
      expect(await savedB.json()).toMatchObject({ content: "Body belonging to B", status: "draft" });
      const unchangedA = await page.request.get(`${E2E_API_URL}/admin/posts/${articleA.id}`);
      expect(await unchangedA.json()).toMatchObject({ content: "Preserved submitted body" });

      await page.getByRole("button", { name: "Back to content list" }).click();
      await page.locator(".editor-post-card").filter({ has: page.getByText(articleA.title, { exact: true }) }).getByRole("button", { name: "Edit", exact: true }).click();
      await expect(body).toHaveValue("Preserved submitted body");
      await expect.poll(() => save.evaluate(button => button.closest("form")!.getAnimations({ subtree: true })
        .filter(animation => animation.playState === "running" || animation.pending).length)).toBe(0);
      const savedURL = page.url();
      const publishedSavePresentation = await presentation(save);
      const publishedSidebar = await sidebarPresentation(sidebar);
      await save.evaluate(button => {
        const element = button as HTMLElement & { finishSaveCheck?: () => string[] };
        const baseline = element.outerHTML;
        const errors = new Set<string>();
        let frame = 0;
        const sample = () => {
          if (!element.isConnected) errors.add("Save button detached");
          if (element.textContent?.trim() !== "Save") errors.add("Save label changed");
          if (getComputedStyle(element).opacity !== "1") errors.add("Save faded");
          frame = requestAnimationFrame(sample);
        };
        sample();
        element.finishSaveCheck = () => {
          cancelAnimationFrame(frame);
          if (element.outerHTML !== baseline) errors.add("Save presentation changed after completion");
          return [...errors];
        };
      });
      const successfulSaveGate = new Promise<void>(resolve => { release = resolve; });
      await page.route(endpoint, async route => {
        if (route.request().method() !== "PUT") return route.continue();
        await successfulSaveGate;
        await route.continue();
      });
      await save.click();
      await expect(save).toBeDisabled();
      await expect(save).toHaveAccessibleName("Save");
      expect(await presentation(save)).toEqual(publishedSavePresentation);
      release();
      await expect(save).toBeEnabled();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "status");
      await expect(page).toHaveURL(savedURL);
      expect(await presentation(save)).toEqual(publishedSavePresentation);
      expect(await sidebarPresentation(sidebar)).toEqual(publishedSidebar);
      expect(await save.evaluate(button => (button as HTMLElement & { finishSaveCheck?: () => string[] }).finishSaveCheck?.())).toEqual([]);
      await page.unroute(endpoint);
      await expect(page.getByRole("link", { name: "View article" })).toHaveText("");
      await expect(page.getByRole("link", { name: "View article" })).toHaveAttribute("title", "View article");
      const publishedScreenshot = testInfo.outputPath(`published-controls-${theme}.png`);
      await page.screenshot({ path: publishedScreenshot });
      await testInfo.attach(`Published controls (${theme})`, { path: publishedScreenshot, contentType: "image/png" });
      await page.getByRole("button", { name: "Draft", exact: true }).click();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "status");
      await expect(sidebar.getByRole("link", { name: `${name} 1`, exact: true })).toBeVisible();
      await expect(sidebar).toHaveAttribute("data-preserved", "yes");
      await attachSidebar(sidebar, testInfo, "after withdrawing publication");
      expect(await sidebarPresentation(sidebar)).toEqual(beforeSidebar);
      expect(await sidebar.evaluate(element => (element as MonitoredSidebar).finishStabilityCheck?.()))
        .toEqual([]);
      await page.goto("/login");
      const homeLink = page.getByRole("link", { name: "Return Home" });
      await expect(homeLink).toBeVisible();
      await expect(homeLink).toHaveText("");
      await expect(homeLink).toHaveAttribute("title", "Return Home");
      await homeLink.focus();
      const loginScreenshot = testInfo.outputPath(`login-controls-${theme}.png`);
      await page.screenshot({ path: loginScreenshot });
      await testInfo.attach(`Login controls (${theme})`, { path: loginScreenshot, contentType: "image/png" });
      await homeLink.press("Enter");
      await expect(page).toHaveURL("/");
    } finally {
      release();
      if (!page.isClosed() && await sidebar.count()) {
        await sidebar.evaluate(element => (element as MonitoredSidebar).finishStabilityCheck?.());
      }
      for (const post of posts) await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
      await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
    }
  });
}
