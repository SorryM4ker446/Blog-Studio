import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./test-env";

export async function loginAdmin(page: Page) {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const headers = { "X-CSRF-Token": (await csrf.json()).csrf_token };
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers, data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  return { "X-CSRF-Token": (await (await page.request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token };
}

export async function scanAccessibility(page: Page, info: TestInfo, label: string) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  const results = await new AxeBuilder({ page }).analyze();
  await info.attach(`axe-${label}`, { body: JSON.stringify(results), contentType: "application/json" });
  expect(results.violations.filter(item => ["serious", "critical"].includes(item.impact || ""))
    .map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), label).toEqual([]);
}

export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll('.content-scroll, [role="dialog"], [role="alertdialog"], dialog')]
    .filter(element => element.getClientRects().length > 0)
    .filter(element => element.scrollWidth > element.clientWidth + 1)
    .map(element => ({ tag: element.tagName, class: element.className, width: element.clientWidth, scroll: element.scrollWidth })));
  expect(overflow, `Horizontal overflow at ${page.url()}`).toEqual([]);
}
