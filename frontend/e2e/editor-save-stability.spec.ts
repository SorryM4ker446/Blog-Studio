import { expect, test, type Locator } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL, E2E_APP_URL } from "./support/test-env";

async function presentation(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { opacity: style.opacity, background: style.backgroundColor, color: style.color,
      x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

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
    let release = () => {};
    try {
      for (const [suffix, status] of [["anchor", "published"], ["A", "draft"], ["B", "draft"]]) {
        const response = await page.request.post(`${E2E_API_URL}/admin/posts`, {
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
      const status = page.getByRole("combobox", { name: "Publication status" });
      await expect(save).toHaveAccessibleName("Save");
      await status.click();
      await expect(page.getByRole("listbox", { name: "Publication status" })).toHaveCSS("opacity", "1");
      const controlsScreenshot = testInfo.outputPath(`editor-controls-${theme}.png`);
      await page.screenshot({ path: controlsScreenshot });
      await testInfo.attach(`Editor controls (${theme})`, { path: controlsScreenshot, contentType: "image/png" });
      await status.press("Escape");
      const sidebar = page.locator(".sidebar .nav-menu");
      await expect(sidebar.getByRole("link", { name: `${name} 1`, exact: true })).toBeVisible();
      const beforeSidebar = await sidebar.screenshot();
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
      await expect(page.getByRole("button", { name: "Back to content list" })).toBeDisabled();
      await expect(page.locator("#post-title")).toBeDisabled();
      await expect(page.locator("#post-summary")).toBeDisabled();
      await expect(body).toBeDisabled();
      await expect(page.getByRole("combobox", { name: "Post category" })).toBeDisabled();
      expect(await presentation(save)).toEqual(beforeSave);
      expect(await presentation(status)).toEqual(beforeStatus);
      expect(await sidebar.screenshot()).toEqual(beforeSidebar);
      release();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "alert");
      await expect(save).toBeEnabled();
      await expect(body).toHaveValue("Preserved submitted body");
      expect(await sidebar.screenshot()).toEqual(beforeSidebar);
      await page.unroute(endpoint);

      await status.click();
      await page.getByRole("option", { name: "Published", exact: true }).click();
      await sidebar.evaluate(element => element.setAttribute("data-preserved", "yes"));
      const publishGate = new Promise<void>(resolve => { release = resolve; });
      await page.route(endpoint, async route => {
        if (route.request().method() !== "PUT") return route.continue();
        await publishGate;
        await route.continue();
      });
      await save.click();
      await expect(body).toBeDisabled();
      await expect(page.getByRole("button", { name: "Back to content list" })).toBeDisabled();
      await page.keyboard.type("Must not replace submitted content");
      await expect(body).toHaveValue("Preserved submitted body");
      expect(await sidebar.screenshot()).toEqual(beforeSidebar);
      release();
      await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
      await page.unroute(endpoint);
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
      await status.click();
      await page.getByRole("option", { name: "Draft", exact: true }).click();
      await save.click();
      await expect(page.locator("#post-save-message")).toHaveAttribute("role", "status");
      await expect(sidebar.getByRole("link", { name: `${name} 1`, exact: true })).toBeVisible();
      await expect(sidebar).toHaveAttribute("data-preserved", "yes");
      expect(await sidebar.screenshot()).toEqual(beforeSidebar);
    } finally {
      release();
      for (const post of posts) await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
      await page.request.delete(`${E2E_API_URL}/admin/categories/${category.id}`, { headers });
    }
  });
}
