import { expect, test } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { loginAdmin } from "./support/accessibility";
import { createArticle } from "./support/articles";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) test(`post delete hint supports hover and focus in ${theme}`, async ({ page, context }) => {
  await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
  const headers = await loginAdmin(page);
  const response = await createArticle(page.request, { headers, data: { title: "Delete hint", content: "Tooltip test", status: "draft", category_id: 0 } });
  const post = await response.json();
  try {
    await page.goto("/editor");
    const button = page.getByRole("button", { name: "Delete Delete hint", exact: true });
    await expect(button).not.toHaveAttribute("title");
    await button.hover();
    await expect.poll(() => button.evaluate(node => getComputedStyle(node, "::after").opacity)).toBe("1");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.screenshot({ path: path.join(os.tmpdir(), `blog-post-delete-hint-${theme}.png`) });
    await page.mouse.move(0, 0);
    await expect.poll(() => button.evaluate(node => getComputedStyle(node, "::after").visibility)).toBe("hidden");
    await page.keyboard.press("Tab");
    await button.focus();
    await expect.poll(() => button.evaluate(node => getComputedStyle(node, "::after").visibility)).toBe("visible");
  } finally {
    await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
  }
});
