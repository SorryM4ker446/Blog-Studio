import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";
import type { HomepageLink } from "../src/lib/links";

async function clearLinks(page: import("@playwright/test").Page, headers: Record<string,string>, ids: number[]) {
  if (!ids.length) return;
  const links: HomepageLink[] = await (await page.request.get(`${E2E_API_URL}/admin/links`)).json();
  for (const link of links.filter(item => ids.includes(item.id))) await page.request.delete(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { version: link.version } });
}
for (const theme of ["dark", "light"]) {
  test(`homepage links can be edited, ordered and browsed in ${theme}`, async ({ page, context }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const headers = await loginAdmin(page);
    const ids: number[] = [];
    const errors: string[] = [];
    page.on("pageerror", err => errors.push(err.message));
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    try {
      await page.goto("/editor?tab=links");
      await expect(page).toHaveTitle("Blog Studio");
      await expect(page.getByRole("tab", { name: /^Links/ })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "+ New Link", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New link" });
      await dialog.getByRole("button", { name: "Save link", exact: true }).click();
      await expect(dialog.getByText("Enter a link title.")).toBeVisible();
      await dialog.getByLabel("TITLE", { exact: true }).fill(`Links ${theme} 1`);
      await dialog.getByLabel("DESCRIPTION", { exact: true }).fill("A useful destination, managed from Content Editor.");
      await dialog.getByLabel("DESTINATION URL", { exact: true }).fill("https://example.com/one");
      await dialog.getByRole("button", { name: "globe icon" }).click();
      await dialog.getByRole("button", { name: "green color" }).click();
      await scanAccessibility(page,info,`link-dialog-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(),`blog-links-editor-${theme}.png`) });
      const createdResponse = page.waitForResponse(response => response.url().endsWith("/api/admin/links") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Save link", exact: true }).click();
      const first: HomepageLink = await (await createdResponse).json(); ids.push(first.id);
      await expect(dialog).toHaveCount(0);
      for (let index=2; index<=6; index++) {
        const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: { title: `Links ${theme} ${index}`, description: `Shortcut number ${index}`, url: `https://example.com/${index}`, icon: index%2 ? "code" : "book", color: "blue", visible: true, request_id: crypto.randomUUID() } });
        expect(response.ok()).toBeTruthy(); ids.push((await response.json()).id);
      }
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "+ New Link", exact: true })).toHaveClass("editor-primary-action");
      await page.getByRole("tab", { name: /^Files/ }).click();
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "editor-files-tab");
      await page.getByRole("tab", { name: /^Links/ }).click();
      const last = page.getByRole("article", { name: `Links ${theme} 6`, exact: true });
      await last.getByRole("button", { name: `Move Links ${theme} 6 earlier` }).click();
      await expect.poll(() => page.getByRole("article").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).toEqual([1,2,3,4,6,5].map(n => `Links ${theme} ${n}`));
      await expect(page.getByText("Link order updated.")).toHaveCount(0);
      await page.screenshot({ path: path.join(os.tmpdir(),`blog-links-manager-${theme}.png`) });
      await page.getByRole("link", { name:"Posts Playground", exact:true }).click();
      const gallery = page.getByRole("region", { name: "Featured links" });
      const cards = gallery.getByRole("link");
      await expect(cards).toHaveCount(6);
      await expect(cards.first()).toHaveAttribute("href","https://example.com/one");
      await expect(cards.first()).toHaveAttribute("target","_blank");
      await expect(cards.first()).toHaveAttribute("rel","noopener noreferrer");
      const boxes = await cards.evaluateAll(nodes => nodes.map(node => { const rect=node.getBoundingClientRect(); return { x:rect.x,y:rect.y,width:rect.width }; }));
      expect(new Set(boxes.map(box => box.y)).size).toBe(1);
      expect(boxes[3].x + boxes[3].width).toBeLessThan(1600);
      expect(boxes[4].x).toBeGreaterThan(boxes[3].x);
      await expect(gallery.getByRole("button")).toHaveCount(0);
      await expect(page.locator(".route-transition-frame")).not.toHaveClass(/route-transition-active/);
      await page.screenshot({ path: path.join(os.tmpdir(),`blog-links-home-${theme}.png`) });
      const track = gallery.getByLabel("Browse links");
      const bounds = (await track.boundingBox())!;
      const popupCount = context.pages().length;
      await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 45);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 30, bounds.y + 45, { steps: 15 });
      await page.mouse.up();
      await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
      expect(context.pages().length).toBe(popupCount);
      await track.focus(); await page.keyboard.press("Home");
      await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeLessThan(1);
      await context.route("https://example.com/**", route => route.fulfill({ body: "Link destination" }));
      const popupEvent = page.waitForEvent("popup");
      await cards.first().click();
      const popup = await popupEvent;
      await expect(popup).toHaveURL("https://example.com/one");
      await popup.close();
      await scanAccessibility(page,info,`links-home-${theme}`);
      await page.setViewportSize({ width:375,height:850 });
      await expect.poll(() => page.locator(".content-scroll").evaluate(node => node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
      await expectNoOverflow(page);
      await gallery.getByLabel("Browse links").focus();
      await page.keyboard.press("Home");
      await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeLessThan(1);
      await page.screenshot({ path:path.join(os.tmpdir(),`blog-links-mobile-${theme}.png`) });
      await page.emulateMedia({ reducedMotion:"reduce" });
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
      await page.keyboard.press("Home");
      const touch = await context.newCDPSession(page);
      const mobileBounds = (await track.boundingBox())!;
      const y = mobileBounds.y + 45;
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 310, y }] });
      for (const x of [270,220,170,120,60]) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
      await touch.detach();
      await page.setViewportSize({ width:1600,height:1000 });
      await page.goto("/editor?tab=links");
      const firstRow = page.getByRole("article", { name:`Links ${theme} 1`, exact:true });
      await firstRow.getByRole("button", { name:"Edit", exact:true }).click();
      await page.getByLabel("Show on homepage").uncheck();
      await page.getByRole("button", { name:"Save link", exact:true }).click();
      await expect(firstRow.getByText("Hidden", { exact:true })).toBeVisible();
      await firstRow.getByRole("button", { name:"Delete", exact:true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name:"Delete", exact:true }).click();
      await expect(firstRow).toHaveCount(0);
      await page.getByRole("link", { name:"Posts Playground", exact:true }).click();
      await expect(page.getByRole("region",{name:"Featured links"}).getByRole("link")).toHaveCount(5);
      expect(errors).toEqual([]);
    } finally { await clearLinks(page,headers,ids); }
  });
}

test("link search, last-page deletion and direct dialog cancellation preserve navigation", async ({page}) => {
  const headers=await loginAdmin(page); const ids:number[]=[];
  try {
    for(let i=1;i<=9;i++) { const r=await page.request.post(`${E2E_API_URL}/admin/links`,{headers,data:{title:`Managed ${i}`,description:"",url:"",icon:"link",color:"blue",visible:false,request_id:crypto.randomUUID()}}); expect(r.ok()).toBeTruthy(); ids.push((await r.json()).id); }
    await page.goto("/editor?tab=links&link_page=2&edit=1");
    await expect(page.getByRole("article",{name:"Managed 9",exact:true})).toBeVisible();
    await page.getByRole("article",{name:"Managed 9",exact:true}).getByRole("button",{name:"Delete",exact:true}).click();
    await page.getByRole("alertdialog").getByRole("button",{name:"Delete",exact:true}).click();
    await expect(page).not.toHaveURL(/link_page=/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.getByPlaceholder("Search links...").fill("Managed 3");
    await page.getByPlaceholder("Search links...").press("Enter");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("article").getByRole("button",{name:"Edit",exact:true}).click();
    await page.getByLabel("TITLE",{exact:true}).fill("Unsaved link title");
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Edit link"})).toHaveCount(0);
    await expect(page.getByRole("alertdialog",{name:"Leave this editor?"})).toHaveCount(0);
    await page.getByRole("article").getByRole("button",{name:"Edit",exact:true}).click();
    await expect(page.getByLabel("TITLE",{exact:true})).toHaveValue("Managed 3");
    await page.getByLabel("TITLE",{exact:true}).fill("Discard with Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog",{name:"Edit link"})).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.getByRole("tab",{name:/^Posts/}).click();
    await expect(page.getByRole("tab",{name:/^Posts/})).toHaveAttribute("aria-selected","true");
    await page.goBack();
    await expect(page.getByRole("tab",{name:/^Links/})).toHaveAttribute("aria-selected","true");
    await expect(page.getByRole("article")).toHaveCount(1);
  } finally { await clearLinks(page,headers,ids); }
});

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

for (const reducedMotion of [false, true]) {
  test(`Links share tab transitions and retain outgoing content during slow reads (reduced: ${reducedMotion})`, async ({ page }) => {
    await loginAdmin(page);
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await page.goto("/editor?tab=files");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => {
      const panel = document.getElementById("editor-resource-panel")!;
      panel.dataset.motionCount = "0";
      const original = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.id === "editor-resource-panel") panel.dataset.motionCount = String(Number(panel.dataset.motionCount) + 1);
        return original.apply(this, args);
      };
    });
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route("**/api/admin/links", async route => { requested = true; await gate; await route.continue(); });
    try {
      await page.getByRole("tab", { name: /^Links/ }).click();
      await expect.poll(() => requested).toBe(true);
      await expect(panel).toHaveAttribute("aria-labelledby", "editor-files-tab");
      await expect(panel).toHaveAttribute("aria-busy", "true");
      await expect(panel).toHaveCSS("opacity", "1");
      await expect(page.getByText("Loading links…", { exact: true })).toHaveCount(0);
      // Cancel a pending entry by choosing another resource; the late response cannot switch it back.
      await page.getByRole("tab", { name: /^Posts/ }).click();
      release();
      await expect(panel).toHaveAttribute("aria-labelledby", "editor-posts-tab");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await page.getByRole("tab", { name: /^Links/ }).click();
      await expect(panel).toHaveAttribute("aria-labelledby", "editor-links-tab");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("tab", { name: "Links (0)", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No links yet", exact: true })).toBeVisible();
      if (reducedMotion) await expect(panel).toHaveAttribute("data-motion-count", "0");
      else await expect.poll(() => panel.getAttribute("data-motion-count").then(Number)).toBeGreaterThan(0);
      await page.getByRole("tab", { name: /^Links/ }).focus();
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByRole("tab", { name: /^Files/ })).toBeFocused();
      await expect(panel).toHaveAttribute("aria-labelledby", "editor-files-tab");
    } finally { release(); }
  });
}

for (const theme of ["dark", "light"]) {
  test(`Links counts survive refresh and revalidation, ordering stays stable and empty states match in ${theme}`, async ({ page, context, browser }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const headers = await loginAdmin(page);
    const ids: number[] = [];
    let releaseRead = () => {};
    let releaseMove = () => {};
    try {
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: {
          title: `Stable ${i}`, description: i === 1 ? "A longer description that wraps naturally inside the card." : "Short description",
          url: "", icon: "link", color: "blue", visible: false, request_id: crypto.randomUUID(),
        } });
        expect(response.ok()).toBeTruthy(); ids.push((await response.json()).id);
      }
      const noJS = await browser.newContext({ javaScriptEnabled: false, storageState: await context.storageState() });
      try {
        const document = await noJS.newPage();
        await document.goto("/editor?tab=posts");
        await expect(document.getByRole("tab", { name: "Links (3)", exact: true })).toBeVisible();
        await document.goto("/editor?tab=links");
        await expect(document.getByRole("article")).toHaveCount(3);
      } finally { await noJS.close(); }
      await page.goto("/editor?tab=posts");
      const linksTab = page.getByRole("tab", { name: "Links (3)", exact: true });
      await expect(linksTab).toBeVisible();
      await page.reload();
      await expect(linksTab).toBeVisible();
      const tabWidth = (await linksTab.boundingBox())!.width;
      let readPending = false;
      const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
      await page.route("**/api/admin/links", async route => { readPending = true; await readGate; await route.continue(); });
      await linksTab.click();
      await expect.poll(() => readPending).toBe(true);
      await expect(linksTab).toBeVisible();
      expect((await linksTab.boundingBox())!.width).toBe(tabWidth);
      releaseRead();
      await expect(page.getByRole("article")).toHaveCount(3);
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      const grid = page.locator("[data-link-id]").first().locator("..");
      const gridTop = (await grid.boundingBox())!.y;
      let moveRequests = 0;
      const moveGate = new Promise<void>(resolve => { releaseMove = resolve; });
      await page.route("**/api/admin/links/*/move", async route => { moveRequests++; await moveGate; await route.continue(); });
      const first = page.getByRole("article", { name: "Stable 1", exact: true });
      const move = first.getByRole("button", { name: "Move Stable 1 later" });
      const beforeOpacity = await move.evaluate(node => getComputedStyle(node).opacity);
      await move.click();
      await expect.poll(() => moveRequests).toBe(1);
      await move.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
      expect(moveRequests).toBe(1);
      expect((await grid.boundingBox())!.y).toBe(gridTop);
      await expect(move).toHaveCSS("opacity", beforeOpacity);
      await expect(page.getByText("Link order updated.")).toHaveCount(0);
      releaseMove();
      await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Stable 2");
      await expect(move).toHaveAttribute("aria-disabled", "false");
      await move.evaluate(node => (node as HTMLButtonElement).click());
      await expect.poll(() => moveRequests).toBe(2);
      await expect(page.getByRole("article").last()).toHaveAttribute("aria-label", "Stable 1");
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      expect((await grid.boundingBox())!.y).toBe(gridTop);
      await expect(page.getByRole("article")).toHaveCount(3);
      await page.getByPlaceholder("Search links...").fill("no-such-destination");
      await page.getByPlaceholder("Search links...").press("Enter");
      const empty = page.getByRole("heading", { name: "No matching links", exact: true }).locator("../..");
      await expect(empty.getByText("Try a different search term.", { exact: true })).toBeVisible();
      const emptyClass = await empty.getAttribute("class");
      await expect(page.getByText("Clear the search to change the homepage order.")).toHaveCount(0);
      await expect(page.getByText("Link order updated.")).toHaveCount(0);
      await scanAccessibility(page, info, `empty-links-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-links-empty-${theme}.png`) });
      await page.getByRole("tab", { name: /^Files/ }).click();
      const filesEmpty = page.getByRole("heading", { name: "No files yet", exact: true }).locator("../..");
      await expect(filesEmpty).toHaveClass(emptyClass!);
    } finally { releaseRead(); releaseMove(); await clearLinks(page, headers, ids); }
  });
}
