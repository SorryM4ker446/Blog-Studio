import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`version conflict review is themed and preserves edits in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1500, height: 1000 });
    const headers = await loginAdmin(page);
    const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title: "Version review", content: "Original content" } });
    expect(response.ok()).toBeTruthy();
    const post = await response.json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error" && !/409|503/.test(event.text())) errors.push(event.text()); });
    try {
      await page.goto(`/editor?edit=${post.id}`);
      const content = page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true });
      await content.fill("My unsaved text");
      const update = await page.request.put(`${E2E_API_URL}/admin/posts/${post.id}`, { headers, data: { title: "Latest article title", content: "New server content\n\nReview this version before replacing your work.", version: post.version } });
      expect(update.ok()).toBeTruthy();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const panel = page.getByRole("region", { name: "Article version conflict" });
      await expect(panel).toBeVisible();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await expect(content).toHaveValue("My unsaved text");
      await page.route(`**/api/admin/posts/${post.id}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unable to load latest version" }) }), { times: 1 });
      await panel.getByRole("button", { name: "Review saved version" }).click();
      await expect(panel.getByRole("alert")).toContainText("Unable to load latest version");
      await panel.getByRole("button", { name: "Review saved version" }).click();
      await expect(panel.getByLabel("Latest saved content")).toHaveValue(/New server content/);
      await expect(content).toHaveValue("My unsaved text");
      await expect(panel.getByLabel("Latest saved content")).toHaveAttribute("readonly");
      const choices = panel.getByRole("button").filter({ hasText: /Keep my edits and continue|Discard my edits and use latest/ });
      const appearance = () => choices.evaluateAll(buttons => buttons.map(button => {
        const style = getComputedStyle(button);
        return { opacity: style.opacity, color: style.color, background: style.backgroundColor, border: style.borderColor, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height };
      }));
      if (theme === "light") {
        expect(await choices.nth(0).evaluate(element => {
          const probe = document.createElement("span");
          probe.style.backgroundColor = "var(--accent-blue)";
          document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const actual = getComputedStyle(element);
          return actual.backgroundColor === expected && actual.color === "rgb(255, 255, 255)";
        })).toBe(true);
      }
      const beforeRefresh = await appearance();
      let releaseRefresh!: () => void;
      const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
      await page.route(`**/api/admin/posts/${post.id}`, async route => {
        await refreshGate;
        await route.continue();
      }, { times: 1 });
      await panel.getByRole("button", { name: "Refresh saved version" }).click();
      try {
        await expect(choices.nth(0)).toBeDisabled();
        await expect(choices.nth(1)).toBeDisabled();
        expect(await appearance()).toEqual(beforeRefresh);
        await expect(panel.getByLabel("Latest saved content")).toHaveValue(/New server content/);
      } finally { releaseRefresh(); }
      await expect(choices.nth(0)).toBeEnabled();
      await expect(choices.nth(1)).toBeEnabled();
      expect(await appearance()).toEqual(beforeRefresh);
      await panel.scrollIntoViewIfNeeded();
      await scanAccessibility(page, info, `conflict-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-conflict-${theme}.png`) });
      await page.setViewportSize({ width: 375, height: 850 });
      await panel.scrollIntoViewIfNeeded();
      await expectNoOverflow(page);
      await scanAccessibility(page, info, `conflict-mobile-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-editor-conflict-mobile-${theme}.png`) });
      await panel.getByRole("button", { name: "Keep my edits and continue" }).click();
      await expect(panel).toHaveCount(0);
      await expect(content).toHaveValue("My unsaved text");
      const reviewed = await update.json();
      const concurrent = await page.request.put(`${E2E_API_URL}/admin/posts/${post.id}`, { headers, data: { title: reviewed.title, content: "Another remote edit", version: reviewed.version } });
      expect(concurrent.ok()).toBeTruthy();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: "Keep my edits and continue" })).toHaveCount(0);
      await panel.getByRole("button", { name: "Review saved version" }).click();
      await expect(panel.getByLabel("Latest saved content")).toHaveValue("Another remote edit");
      await panel.getByRole("button", { name: "Keep my edits and continue" }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
      const saved = await (await page.request.get(`${E2E_API_URL}/admin/posts/${post.id}`, { headers })).json();
      expect(saved.content).toBe("My unsaved text");
      await content.fill("Another local edit");
      expect((await page.request.put(`${E2E_API_URL}/admin/posts/${post.id}`, { headers, data: { title: saved.title, content: "New server content", version: saved.version } })).ok()).toBeTruthy();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await panel.getByRole("button", { name: "Review saved version" }).click();
      await panel.getByRole("button", { name: "Discard my edits and use latest" }).click();
      await expect(panel).toHaveCount(0);
      await expect(content).toHaveValue(/New server content/);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      expect(errors).toEqual([]);
    } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
  });
}
