import { expect, test } from "@playwright/test";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";
import { createArticle } from "./support/articles";
import { expectNoOverflow, loginAdmin, scanAccessibility } from "./support/accessibility";

for (const theme of ["dark", "light"]) {
  test(`core pages and editor dialogs have no serious accessibility violations in ${theme} theme`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.goto("/login");
    await expect(page.locator('aside.sidebar a[href="/login"]')).toHaveAttribute("aria-current", "page");
    await scanAccessibility(page, info, "login");
    const headers = await loginAdmin(page);
    const created = await createArticle(page.request, { headers, data: {
      title: `Accessible article ${theme}`, status: "published", category_id: 0,
      content: `A long link: [${"longword".repeat(30)}](https://example.com)\n\n| Column | Details |\n| --- | --- |\n| text | ${"wide".repeat(100)} |\n\n\`\`\`\n${"code ".repeat(100)}\n\`\`\`\n\n![diagram =320x180](/missing-test-image.png)`,
    }});
    const post = await created.json();
    let fileId: number | undefined;
    try {
      const uploaded = await page.request.post(`${E2E_API_URL}/admin/files`, { headers, multipart: {
        file: { name: "accessible-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Accessible file contents.") },
        display_name: `Accessible ${"long-file-name-".repeat(10)}`, description: "A file for keyboard preview and download.",
      } });
      expect(uploaded.ok()).toBeTruthy();
      fileId = (await uploaded.json()).id;
      for (const path of ["/", "/posts", `/posts/${post.id}`, "/drive", "/search?q=Accessible", "/editor", "/settings"]) {
        await page.goto(path);
        const section = path.startsWith("/posts") ? "/posts" : path.split("?")[0];
        await expect(page.locator(`aside.sidebar a[href="${section}"]`)).toHaveAttribute("aria-current", "page");
        await expect(page.locator('aside.sidebar [aria-current="page"]')).toHaveCount(1);
        await expect(page.locator("h1").first()).toBeVisible();
        if (path === "/editor") await expect(page.locator(".editor-post-title").filter({ hasText: post.title })).toBeVisible();
        if (path === `/posts/${post.id}`) {
          const image = page.locator(".post-body img");
          await expect(image).toHaveAttribute("loading", "lazy");
          await expect(image).toHaveAttribute("decoding", "async");
          await expect(image).toHaveAttribute("width", "320");
          await expect(image).toHaveAttribute("height", "180");
        }
        await scanAccessibility(page, info, path.replaceAll("/", "-") || "home");
        await expectNoOverflow(page);
      }
      await page.getByRole("button", { name: "Log Out Securely" }).press("Enter");
      await scanAccessibility(page, info, "logout-dialog");
      await expectNoOverflow(page);
      await page.keyboard.press("Escape");
      await page.goto("/drive");
      await page.locator(`[data-file-id="${fileId}"]`).getByRole("button", { name: /^Preview/ }).press("Enter");
      await scanAccessibility(page, info, "file-preview");
      const download = page.waitForEvent("download");
      await page.getByRole("dialog").getByRole("link", { name: "Download", exact: true }).press("Enter");
      expect((await download).suggestedFilename()).toBeTruthy();
      await expectNoOverflow(page);
      await page.keyboard.press("Escape");
      await page.goto(`/editor?edit=${post.id}`);
      await expect(page.getByLabel("CONTENT (MARKDOWN) · REQUIRED", { exact: true })).toBeVisible();
      await scanAccessibility(page, info, "edit-form");
      await page.getByLabel("POST TITLE").fill("Accessible unsaved title");
      await page.getByRole("button", { name: "Back to content list" }).press("Enter");
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await scanAccessibility(page, info, "leave-dialog");
      await page.getByRole("button", { name: "Leave editor", exact: true }).press("Enter");
      await page.getByRole("tab", { name: /Files/ }).press("Enter");
      await page.getByRole("button", { name: "Upload File", exact: true }).press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await scanAccessibility(page, info, "upload-dialog");
    } finally {
      await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
      if (fileId) await page.request.delete(`${E2E_API_URL}/admin/files/${fileId}`, { headers });
    }
  });
}
