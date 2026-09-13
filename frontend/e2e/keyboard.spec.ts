import { expect, test, type Page, type Locator } from "@playwright/test";
import { E2E_APP_URL, E2E_API_URL, E2E_ADMIN_USER, E2E_ADMIN_PASS } from "./support/test-env";
import { scanAccessibility } from "./support/accessibility";

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 70; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

for (const theme of ["dark", "light"]) {
test(`keyboard login, category management, Markdown editing and resource tabs in ${theme} theme`, async ({ page, context }, info) => {
  await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
  const name = `Keyboard category ${info.project.name}`;
  let categoryId: number | undefined;
  let postId: number | undefined;
  await page.goto("/login?redirect=%2Feditor");
  await tabTo(page, page.getByLabel("Username"));
  await page.keyboard.type(E2E_ADMIN_USER);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(E2E_ADMIN_PASS); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await navigation.isVisible()) { await tabTo(page, navigation); await page.keyboard.press("Enter"); }
  await tabTo(page, page.getByRole("link", { name: "Content Editor", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(url => url.pathname === "/editor" && url.searchParams.get("tab") === "posts");
  await expect(page.getByRole("tab", { name: /^Posts/ })).toHaveAttribute("aria-selected", "true");
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const headers = { "X-CSRF-Token": (await csrf.json()).csrf_token };
  try {
    await tabTo(page, page.getByRole("button", { name: "+ New Post", exact: true }));
    await page.keyboard.press("Enter");
    await tabTo(page, page.getByLabel("POST TITLE"));
    await page.keyboard.type("Keyboard article");
    await tabTo(page, page.getByRole("button", { name: "Create category", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Category name", { exact: true })).toBeFocused();
    await page.keyboard.type(name);
    const createResponse = page.waitForResponse(response => response.url().endsWith("/admin/categories") && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    categoryId = (await (await createResponse).json()).id;
    await expect(page.getByRole("button", { name: "Create category", exact: true })).toBeFocused();
    const select = page.getByRole("combobox", { name: "Post category" });
    await page.keyboard.press("Shift+Tab"); await expect(select).toBeFocused();
    await page.keyboard.press("Enter"); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
    await expect(select).toHaveText(/None/);
    await page.keyboard.press("Enter"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
    await expect(select).toHaveText(new RegExp(name));
    await page.keyboard.press("Enter"); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: `Rename ${name}`, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByLabel("New category name").press("ControlOrMeta+A");
    await page.keyboard.type(`${name} renamed`); await page.keyboard.press("Enter");
    await expect(select).toBeFocused();
    await expect(select).toHaveText(new RegExp(`${name} renamed`));
    await expect(select).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: `Delete ${name} renamed`, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    const deletion = page.getByRole("alertdialog", { name: "Confirm Deletion" });
    await expect(deletion.getByRole("button", { name: "Cancel" })).toBeFocused();
    await scanAccessibility(page, info, "category-deletion");
    await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await expect(deletion).not.toBeVisible();
    categoryId = undefined;
    await expect(select).toBeFocused();
    await tabTo(page, page.getByRole("textbox", { name: "CONTENT (MARKDOWN) · REQUIRED", exact: true }));
    await page.keyboard.type("Text written with the keyboard.");
    await tabTo(page, page.getByRole("button", { name: "Header", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "H1", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "H2", exact: true })).toBeFocused();
    await scanAccessibility(page, info, "heading-picker");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "CONTENT (MARKDOWN) · REQUIRED", exact: true })).toHaveValue(/## /);
    await tabTo(page, page.getByRole("button", { name: "Table", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Insert table: 1 rows, 1 columns", exact: true })).toBeFocused();
    await scanAccessibility(page, info, "table-picker");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Table", exact: true })).toBeFocused();
    await tabTo(page, page.getByRole("button", { name: "Save", exact: true }));
    const save = page.waitForResponse(response => response.url().endsWith("/admin/posts") && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    postId = (await (await save).json()).id;
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Back to content list" }));
    await page.keyboard.press("Enter");
    const postsTab = page.getByRole("tab", { name: /Posts/ });
    await tabTo(page, postsTab); await page.keyboard.press("ArrowRight");
    const filesTab = page.getByRole("tab", { name: /Files/ });
    await expect(filesTab).toBeFocused(); await expect(filesTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home"); await expect(postsTab).toBeFocused();
    await expect(postsTab).toHaveAttribute("aria-selected", "true");
  } finally {
    if (postId) await page.request.delete(`${E2E_API_URL}/admin/posts/${postId}`, { headers });
    if (categoryId) await page.request.delete(`${E2E_API_URL}/admin/categories/${categoryId}`, { headers });
  }
});

}
