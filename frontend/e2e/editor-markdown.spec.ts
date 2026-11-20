import path from "node:path";
import os from "node:os";
import { expect, test } from "@playwright/test";
import { createArticle } from "./support/articles";
import { loginAdmin } from "./support/auth";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";

test("Markdown validation keeps rounded chrome and usable toolbar menus", async ({page}) => {
 await loginAdmin(page);
 await page.setViewportSize({width:1600,height:1000});
 await page.goto("/editor?edit=new");
 await page.getByRole("button",{name:"Save",exact:true}).click();
 const editor=page.locator(".custom-editor-wrapper .rc-md-editor");
 await expect(page.locator("#post-content-error")).toHaveText("Please enter some post content.");
 await expect(editor).toHaveCSS("border-radius","12px");
 await expect(editor.locator(".rc-md-navigation")).toHaveCSS("border-top-left-radius","11px");
 await expect(editor.locator(".editor-container")).toHaveCSS("border-bottom-left-radius","11px");
 await page.getByRole("button",{name:"Header",exact:true}).focus();
 await page.keyboard.press("Enter");
 await expect(page.getByRole("button",{name:"H1",exact:true})).toBeVisible();
 await page.keyboard.press("Escape");
 await page.locator("#post-content-error").scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(os.tmpdir(),"blog-editor-rounded-error.png")});
 await page.locator(".button-type-fullscreen").click();
 await expect(editor).toHaveClass(/full/);
 await expect(page.getByRole("button",{name:"Header",exact:true})).toBeVisible();
 await page.locator(".button-type-fullscreen").click();
});

function readMarkdownStyles(body: Element) {
  return Array.from(body.querySelectorAll("code, pre, th, blockquote, blockquote p, a"), element => {
    const { color, backgroundColor, borderLeftColor, borderRadius, fontFamily, fontSize, textDecorationLine } = getComputedStyle(element);
    return { element: element.tagName, color, backgroundColor, borderLeftColor, borderRadius, fontFamily, fontSize, textDecorationLine };
  });
}

for (const { theme, background, textColor } of [
  { theme: "dark", background: "rgba(255, 255, 255, 0.08)", textColor: "rgb(242, 242, 242)" },
  { theme: "light", background: "rgba(0, 0, 0, 0.04)", textColor: "rgb(22, 23, 25)" },
]) {
  test(`the Markdown preview matches article styles in ${theme} mode`, async ({ page, context }) => {
    const headers = await loginAdmin(page);
    const title = `Markdown styling in ${theme} mode`;
    const response = await createArticle(page.request, {
      headers,
      data: {
        title,
        content: [
          "Call `generateImage` to render the image. See [model documentation](https://example.com).",
          "```js\ngenerateImage();\n```",
          "| Parameter | Value |\n| --- | --- |\n| Size | 1024 |",
          "> The generated image is ready.",
        ].join("\n\n"),
        status: "published",
      },
    });
    const { id } = await response.json();

    try {
      await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
      const article = page.locator(".post-detail .post-body");
      await page.goto(`/posts/${id}`);
      await expect(article.getByRole("link", { name: "model documentation" })).toBeVisible();
      const standaloneStyles = await article.evaluate(readMarkdownStyles);

      await page.goto(`/editor?tab=posts&edit=${id}`);
      const preview = page.locator(".custom-editor-wrapper .post-body");
      const previewCode = preview.locator("p > code");
      await expect(previewCode).toHaveText("generateImage");
      await expect(previewCode).toBeVisible();
      await expect(previewCode).toHaveCSS("background-color", background);
      await expect(previewCode).toHaveCSS("color", textColor);
      expect(await preview.evaluate(readMarkdownStyles)).toEqual(standaloneStyles);

      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole("link", { name: "View article" }).click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

      const articleCode = article.locator("p > code");
      await expect(articleCode).toHaveText("generateImage");
      await expect(articleCode).toBeVisible();
      await expect(articleCode).toHaveCSS("background-color", background);
      await expect(articleCode).toHaveCSS("color", textColor);
      await expect(article.locator("pre > code")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(article.getByRole("columnheader", { name: "Parameter" })).toHaveCSS("border-top-style", "solid");
      expect(await article.evaluate(readMarkdownStyles)).toEqual(standaloneStyles);
    } finally {
      expect((await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers })).ok()).toBeTruthy();
    }
  });
}
