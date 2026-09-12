import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL, E2E_APP_URL } from "./support/test-env";
import { answerLeaveDialog } from "./support/editor-navigation";

async function copyCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("blog-studio-editor-recovery", 1);
    request.onerror = () => reject(new Error("Test copy inspection failed"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("copies");
      const count = tx.objectStore("copies").count();
      count.onsuccess = () => resolve(count.result);
      tx.oncomplete = () => db.close();
    };
  }));
}

for (const theme of ["dark", "light"]) {
  test(`recovery choices and leave confirmation use the ${theme} theme without server writes`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
    const login = await page.request.post(`${E2E_API_URL}/login`, {
      headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
      data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
    });
    expect(login.ok()).toBeTruthy();
    let writes = 0;
    context.on("request", request => { if (["POST", "PUT"].includes(request.method()) && request.url().includes("/admin/posts")) writes++; });
    page.on("dialog", dialog => { expect(dialog.type()).toBe("beforeunload"); void dialog.accept(); });
    await page.goto("/editor?tab=posts&edit=new");
    await page.getByLabel("POST TITLE").fill("Design notes · A quieter writing space");
    await page.locator(".custom-editor-wrapper textarea").fill("An unsaved thought, kept in this browser.");
    await expect.poll(() => copyCount(page)).toBe(1);
    const other = await context.newPage();
    try {
      await other.goto("/editor?tab=posts&edit=new");
      await other.getByRole("button", { name: "Restore copy 1", exact: true }).click();
      await other.getByLabel("POST TITLE").fill("An earlier draft from another tab");
      await expect.poll(() => copyCount(page)).toBe(2);
      await page.reload();
      const notice = page.getByRole("region", { name: "Browser recovery" });
      await expect(notice.getByRole("listitem")).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg-surface").trim());
      expect(await notice.evaluate((element, expected) => {
        const probe = document.createElement("span"); probe.style.backgroundColor = expected;
        document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove();
        return getComputedStyle(element).backgroundColor === color;
      }, surface)).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))));
      await page.screenshot({ path: testInfo.outputPath("recovery-choices.png") });
      await notice.getByRole("button", { name: "Restore copy 1", exact: true }).click();
      const title = await page.getByLabel("POST TITLE").inputValue();
      const url = page.url();
      const back = page.getByRole("button", { name: "Back to content list" });
      await back.click();
      const dialog = page.getByRole("alertdialog", { name: "Leave this editor?" });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
      const stay = dialog.getByRole("button", { name: "Stay in editor" });
      const leave = dialog.getByRole("button", { name: "Leave editor", exact: true });
      await expect(stay).toBeFocused();
      await page.keyboard.press("Tab"); await expect(leave).toBeFocused();
      await page.keyboard.press("Tab"); await expect(stay).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("leave-confirmation.png") });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(back).toBeFocused();
      await expect(page).toHaveURL(url);
      await expect(page.getByLabel("POST TITLE")).toHaveValue(title);
      await back.click(); await answerLeaveDialog(page, true);
      await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
      expect(writes).toBe(0);
      await page.goto(url);
      await page.getByRole("button", { name: "Discard browser copies" }).click();
      await expect(notice).toHaveCount(0);
      await expect.poll(() => copyCount(page)).toBe(0);
      expect(writes).toBe(0);
    } finally { await other.close(); }
  });
}
