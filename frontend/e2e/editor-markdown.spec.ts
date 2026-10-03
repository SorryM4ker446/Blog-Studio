import path from "node:path";
import os from "node:os";
import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/auth";

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
