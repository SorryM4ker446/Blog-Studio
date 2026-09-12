import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

function expectedDate(value: string, includeTime = false) {
  const shifted = new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString();
  const date = shifted.slice(0, 10).replaceAll("-", "/");
  return includeTime ? `${date} ${shifted.slice(11, 19)}` : date;
}

async function confirmHydrated(page: Page) {
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("html")).toHaveClass("theme-light");
  await page.getByRole("button", { name: "Switch to Dark Mode" }).click();
  await expect(page.locator("html")).not.toHaveClass("theme-light");
}

for (const settings of [
  { locale: "en-US", timezoneId: "America/Los_Angeles" },
  { locale: "ar-EG", timezoneId: "Pacific/Kiritimati" },
]) {
  test.describe(`date rendering in ${settings.locale} and ${settings.timezoneId}`, () => {
    test.use(settings);

    test("populated pages keep server dates through hydration, reload and editor recovery", async ({ page, context }) => {
      const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
      const login = await page.request.post(`${E2E_API_URL}/login`, {
        headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
        data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
      });
      expect(login.ok()).toBe(true);
      const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
      const title = `Date rendering ${Date.now()}`;
      let postId = 0;
      let fileId = 0;
      try {
        const created = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title, content: "Date display fixture" } });
        expect(created.ok()).toBe(true);
        const draft = await created.json();
        postId = draft.id;
        const published = await page.request.post(`${E2E_API_URL}/admin/posts/${postId}/publish`, { headers, data: { version: draft.version } });
        expect(published.ok()).toBe(true);
        const post = await published.json();
        const uploaded = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
          file: { name: "date-rendering.txt", mimeType: "text/plain", buffer: Buffer.from("Plain notes for date display verification.") },
          display_name: title,
        } });
        expect(uploaded.ok()).toBe(true);
        const file = await uploaded.json();
        fileId = file.id;
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (message.type() === "error" && /hydrat|server rendered|#418/i.test(message.text())) errors.push(message.text());
        });
        let writes = 0;
        context.on("request", request => {
          if (["POST", "PUT"].includes(request.method()) && /\/admin\/(posts|files)/.test(request.url())) writes++;
        });
        const date = expectedDate(post.published_at);
        const query = encodeURIComponent(title);
        const routes = [
          { url: "/", selector: `a[href="/posts/${postId}"]`, date },
          { url: `/posts?q=${query}`, selector: `a[href="/posts/${postId}"]`, date },
          { url: `/search?q=${query}&scope=all`, selector: `a[href="/posts/${postId}"]`, date },
          { url: `/drive?q=${query}`, selector: `[data-file-id="${fileId}"]`, date: expectedDate(file.created_at) },
          { url: `/editor?tab=posts&q=${query}`, selector: ".editor-post-card", date: expectedDate(post.updated_at) },
          { url: `/editor?tab=files&q=${query}`, selector: `[data-file-id="${fileId}"]`, date: expectedDate(file.created_at) },
          { url: `/posts/${postId}`, selector: ".post-date", date },
        ];
        for (const route of routes) {
          const response = await page.goto(route.url);
          expect(response?.ok()).toBe(true);
          expect(await response!.text()).toContain(route.date);
          const target = page.locator(route.selector).filter({ hasText: route.date }).first();
          await expect(target).toBeVisible();
          await confirmHydrated(page);
          await expect(target).toContainText(route.date);
          expect(errors).toEqual([]);
        }
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await page.goto(`/posts?q=${query}`);
        const reload = await page.reload();
        expect(await reload!.text()).toContain(date);
        await confirmHydrated(page);
        await expect(page.locator(`a[href="/posts/${postId}"]`)).toContainText(date);
        await cdp.detach();

        await page.goto(`/drive?q=${query}`);
        await page.getByRole("button", { name: `Preview ${title}`, exact: true }).click();
        await expect(page.getByRole("dialog")).toContainText(expectedDate(file.created_at, true));
        await page.keyboard.press("Escape");
        await page.goto(`/editor?tab=posts&edit=${postId}`);
        await expect(page.getByText(`Last updated: ${expectedDate(post.updated_at, true)}`, { exact: true })).toBeVisible();
        await page.getByLabel("POST TITLE").fill(`${title} unsaved`);
        page.on("dialog", dialog => { expect(dialog.type()).toBe("beforeunload"); void dialog.accept(); });
        await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
          const request = indexedDB.open("blog-studio-editor-recovery", 1);
          request.onerror = () => reject(new Error("Recovery inspection failed"));
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("copies");
            const records = tx.objectStore("copies").getAll();
            records.onsuccess = () => resolve(records.result.map(copy => copy.fields.title));
            tx.oncomplete = () => db.close();
          };
        }))).toContain(`${title} unsaved`);
        await page.reload();
        const recovery = page.getByRole("region", { name: "Browser recovery" });
        await expect(recovery).toBeVisible();
        const time = recovery.locator("time").first();
        await expect(time).toHaveText(expectedDate((await time.getAttribute("datetime"))!, true));
        await recovery.getByRole("button", { name: "Restore copy 1", exact: true }).click();
        await expect(page.getByLabel("POST TITLE")).toHaveValue(`${title} unsaved`);
        expect(errors).toEqual([]);
        expect(writes).toBe(0);
        const saved = await page.request.get(`${E2E_API_URL}/admin/posts/${postId}`);
        expect(await saved.json()).toMatchObject({ title, version: post.version, updated_at: post.updated_at, published_at: post.published_at });
      } finally {
        if (fileId) expect((await page.request.delete(`${E2E_API_URL}/admin/files/${fileId}`, { headers })).ok()).toBe(true);
        if (postId) expect((await page.request.delete(`${E2E_API_URL}/admin/posts/${postId}`, { headers })).ok()).toBe(true);
      }
    });
  });
}
