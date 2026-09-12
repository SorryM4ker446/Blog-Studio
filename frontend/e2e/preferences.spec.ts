import { expect, test, type Page, type Response } from "@playwright/test";
import { E2E_APP_URL } from "./support/test-env";

declare global {
  interface Window {
    preferenceChanges: string[];
    stopPreferenceMonitor: () => void;
  }
}

async function expectPreferences(page: Page, light: boolean, collapsed: boolean) {
  await expect(page.getByRole("button", { name: `Switch to ${light ? "Dark" : "Light"} Mode` })).toBeVisible();
  await expect(page.getByRole("button", { name: collapsed ? "Expand sidebar" : "Collapse sidebar" })).toBeVisible();
  expect(await page.locator("html").evaluate(element => element.classList.contains("theme-light"))).toBe(light);
  expect(await page.locator("body").evaluate(element => element.classList.contains("theme-light"))).toBe(light);
  expect(await page.locator("html").getAttribute("data-sidebar-state")).toBe(collapsed ? "collapsed" : null);
}

async function expectInitialHTML(response: Response | null, light: boolean, collapsed: boolean) {
  expect(response?.ok()).toBe(true);
  const html = await response!.text();
  const root = html.match(/<html\b[^>]*>/)?.[0] ?? "";
  const body = html.match(/<body\b[^>]*>/)?.[0] ?? "";
  expect(root.includes('class="theme-light"')).toBe(light);
  expect(body.includes('class="theme-light"')).toBe(light);
  expect(root.includes('data-sidebar-state="collapsed"')).toBe(collapsed);
}

for (const storage of ["conflicting legacy values", "throwing getter", "throwing methods"] as const) {
  test(`cookie preferences survive hydration and reloads with ${storage}`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addCookies([
      { name: "blog_theme", value: "light", url: E2E_APP_URL },
      { name: "sidebar_collapsed", value: "true", url: E2E_APP_URL },
      { name: "sidebar_posts_expanded", value: "true", url: E2E_APP_URL },
    ]);
    await page.addInitScript((mode) => {
      localStorage.setItem("blog_theme", "dark");
      localStorage.setItem("sidebar_collapsed", "false");
      localStorage.setItem("blog_token", "obsolete-test-value");
      localStorage.setItem("blog_user", "obsolete-test-value");
      localStorage.setItem("unrelated-preference", "keep");
      const denied = () => { throw new DOMException("Storage denied", "SecurityError"); };
      if (mode === "throwing getter") Object.defineProperty(window, "localStorage", { configurable: true, get: denied });
      if (mode === "throwing methods") {
        for (const method of ["getItem", "setItem", "removeItem"] as const) {
          Object.defineProperty(window.localStorage, method, { configurable: true, value: denied });
        }
      }
      window.preferenceChanges = [];
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const element = record.target as Element;
          if (element !== document.documentElement && element !== document.body) continue;
          if (record.attributeName === "class" && !element.classList.contains("theme-light")) window.preferenceChanges.push("theme");
          if (record.attributeName === "data-sidebar-state" && element.getAttribute("data-sidebar-state") !== "collapsed") window.preferenceChanges.push("sidebar");
        }
      });
      observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["class", "data-sidebar-state"] });
      window.stopPreferenceMonitor = () => observer.disconnect();
      document.addEventListener("pointerdown", window.stopPreferenceMonitor, { capture: true, once: true });
    }, storage);
    // Delay application scripts to expose server/hydration disagreements.
    await page.route("**/_next/static/**/*.js", async route => {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.continue();
    });
    await expectInitialHTML(await page.goto("/posts"), true, true);
    await expectPreferences(page, true, true);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expectPreferences(page, true, false);
    expect(await page.evaluate(() => window.preferenceChanges)).toEqual([]);
    await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Toggle categories" }).click();
    await page.getByRole("button", { name: "Switch to Dark Mode" }).click();
    await expectPreferences(page, false, false);
    const cookies = await context.cookies();
    for (const [name, value] of [["blog_theme", "dark"], ["sidebar_collapsed", "false"], ["sidebar_posts_expanded", "false"]]) {
      const cookie = cookies.find(item => item.name === name)!;
      expect(cookie.value).toBe(value);
      expect(cookie.path).toBe("/");
      expect(cookie.sameSite).toBe("Lax");
      expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 360 * 86400);
    }
    if (storage === "conflicting legacy values") {
      expect(await page.evaluate(() => ({
        theme: localStorage.getItem("blog_theme"), sidebar: localStorage.getItem("sidebar_collapsed"),
        token: localStorage.getItem("blog_token"), user: localStorage.getItem("blog_user"),
        unrelated: localStorage.getItem("unrelated-preference"),
      }))).toEqual({ theme: "dark", sidebar: "false", token: null, user: null, unrelated: "keep" });
    }
    await page.unroute("**/_next/static/**/*.js");
    await expectInitialHTML(await page.reload(), false, false);
    await expectPreferences(page, false, false);
    await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "false");
    // Restore the expected light/collapsed state before the monitored hard reload.
    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await expectInitialHTML(await page.reload(), true, true);
    await expectPreferences(page, true, true);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expectPreferences(page, true, false);
    expect(await page.evaluate(() => window.preferenceChanges)).toEqual([]);
    expect(errors).toEqual([]);
    await session.detach();
  });
}

test("invalid cookie values use stable defaults instead of legacy preferences", async ({ page, context }) => {
  await context.addCookies([
    { name: "blog_theme", value: "LIGHT", url: E2E_APP_URL },
    { name: "sidebar_collapsed", value: "TRUE", url: E2E_APP_URL },
    { name: "sidebar_posts_expanded", value: "1", url: E2E_APP_URL },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem("blog_theme", "light");
    localStorage.setItem("sidebar_collapsed", "true");
  });
  await expectInitialHTML(await page.goto("/posts"), false, false);
  await expectPreferences(page, false, false);
  await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expectPreferences(page, true, false);
});

for (const failure of ["throw", "ignore"] as const) {
  test(`preference controls remain usable when cookie writes ${failure}`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript((mode) => {
      const original = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: () => original.get!.call(document),
        set: () => { if (mode === "throw") throw new DOMException("Cookie denied", "SecurityError"); },
      });
    }, failure);
    await expectInitialHTML(await page.goto("/posts"), false, false);
    await page.getByRole("button", { name: "Switch to Light Mode" }).click();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expectPreferences(page, true, true);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await page.getByRole("button", { name: "Toggle categories" }).click();
    await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
    expect((await context.cookies()).filter(cookie => ["blog_theme", "sidebar_collapsed", "sidebar_posts_expanded"].includes(cookie.name))).toEqual([]);
    await expectInitialHTML(await page.reload(), false, false);
    await expectPreferences(page, false, false);
    await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "false");
    expect(errors).toEqual([]);
  });
}
