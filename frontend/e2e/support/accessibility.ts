import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

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
