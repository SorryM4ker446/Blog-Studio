import { expect, test } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { loginAdmin, expectNoOverflow, scanAccessibility } from "./support/accessibility";
import { E2E_API_URL, E2E_APP_URL } from "./support/test-env";
import type { HomepageLink } from "../src/lib/links";

for (const theme of ["dark", "light"]) {
  test(`link card regions stay aligned with empty and maximum-length text in ${theme}`, async ({ page, context }) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    const headers = await loginAdmin(page);
    const ids: number[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const samples = [
      { title: "No description", description: "", url: "https://example.com/empty", visible: true },
      { title: "W".repeat(100), description: "w".repeat(300), url: `https://example.com/${"x".repeat(1950)}`, visible: true },
      { title: "标题".repeat(50), description: "介绍".repeat(150), url: "https://example.com/chinese", visible: true },
      { title: "No destination", description: "Short introduction", url: "", visible: false },
    ];
    try {
      for (const sample of samples) {
        const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: { ...sample, icon: "star", color: "blue", request_id: crypto.randomUUID() } });
        expect(response.ok()).toBeTruthy();
        ids.push((await response.json()).id);
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/editor?tab=links");
      await expect(page).toHaveTitle("Blog Studio");
      await expect(page.getByRole("article")).toHaveCount(4);
      await expect(page.getByRole("article", { name: "No description", exact: true }).getByText("No introduction provided.")).toBeVisible();
      await expect(page.getByRole("article", { name: "No destination", exact: true }).getByText("Set a destination before enabling this link.")).toBeVisible();
      const geometry = () => page.getByRole("article").evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        const paragraphs = node.querySelectorAll("p");
        return {
          height: rect.height, width: rect.width, top: rect.top,
          description: paragraphs[0].getBoundingClientRect().top - rect.top,
          url: paragraphs[1].getBoundingClientRect().top - rect.top,
          actions: node.querySelector("button")!.getBoundingClientRect().top - rect.top,
          overflow: node.scrollWidth > node.clientWidth,
        };
      }));
      const desktop = await geometry();
      expect(desktop[0].top).toBeCloseTo(desktop[1].top, 0);
      for (const field of ["height", "width", "description", "url", "actions"] as const) {
        expect(Math.max(...desktop.map(row => row[field])) - Math.min(...desktop.map(row => row[field])), field).toBeLessThan(1);
      }
      expect(desktop.every(row => !row.overflow)).toBe(true);
      const longCard = page.getByRole("article", { name: samples[1].title, exact: true });
      const description = longCard.locator("p").first();
      await expect(description).toHaveCSS("-webkit-line-clamp", "2");
      await expect(longCard.locator("p").nth(1)).toHaveCSS("-webkit-line-clamp", "2");
      await expect(description).not.toHaveAttribute("title");
      await description.hover();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(description).not.toHaveAttribute("tabindex");
      await longCard.getByRole("button", { name: "Edit", exact: true }).click();
      const details = page.getByRole("dialog", { name: "Edit link" });
      await expect(details.getByLabel("DESCRIPTION", { exact: true })).toHaveValue(samples[1].description);
      await details.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-links-aligned-${theme}.png`) });
      await page.setViewportSize({ width: 375, height: 850 });
      await expectNoOverflow(page);
      const mobile = await geometry();
      for (const field of ["height", "width", "description", "url", "actions"] as const) {
        expect(Math.max(...mobile.map(row => row[field])) - Math.min(...mobile.map(row => row[field]))).toBeLessThan(1);
      }
      expect(mobile.every(row => !row.overflow)).toBe(true);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-links-aligned-mobile-${theme}.png`) });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/");
      const gallery = page.getByRole("region", { name: "Featured links" });
      await expect(gallery.getByText("No introduction provided.")).toBeVisible();
      const heights = await gallery.getByRole("link").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      expect(heights).toHaveLength(3);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
      await page.goto("/editor?tab=links");
      await page.getByRole("button", { name: "+ New Link", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New link" });
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const preview = dialog.locator("aside");
      const previewHeight = (await preview.boundingBox())!.height;
      await expect(preview.getByText("No introduction provided.")).toBeVisible();
      await dialog.getByLabel("TITLE", { exact: true }).fill(samples[1].title);
      await dialog.getByLabel("DESCRIPTION", { exact: true }).fill(samples[1].description);
      expect((await preview.boundingBox())!.height).toBeCloseTo(previewHeight, 0);
      await expect(dialog.getByLabel("DESCRIPTION", { exact: true })).toHaveValue(samples[1].description);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(errors).toEqual([]);
    } finally { await clearLinks(page, headers, ids); }
  });
}

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
      await expect(dialog.getByRole("slider", { name: "Hue", exact: true })).toHaveCount(0);
      const beforePicker = await dialog.boundingBox();
      await dialog.getByRole("button", { name: "Custom", exact: true }).click();
      const picker = dialog.getByRole("group", { name: "Custom color picker", exact: true });
      await expect(picker).toBeVisible();
      expect(await dialog.boundingBox()).toEqual(beforePicker);
      await picker.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
      expect((await picker.boundingBox())!.width).toBeLessThanOrEqual(272);
      await expect(dialog.locator('input[type="color"]')).toHaveCount(0);
      const plane = picker.locator('[aria-hidden="true"]').first();
      const planeRect = (await plane.boundingBox())!;
      await page.mouse.move(planeRect.x + 20, planeRect.y + 20);
      await page.mouse.down();
      await page.mouse.move(planeRect.x + planeRect.width * .75, planeRect.y + planeRect.height * .25, { steps: 4 });
      await page.mouse.up();
      expect(Number(await picker.getByRole("slider", { name: "Saturation", exact: true }).inputValue())).toBeCloseTo(75, 0);
      await picker.getByLabel("HEX", { exact: true }).fill("#9955cc");
      const hue = dialog.getByRole("slider", { name: "Hue", exact: true });
      await hue.focus(); await page.keyboard.press("ArrowRight");
      const chosenColor = await picker.getByLabel("HEX", { exact: true }).inputValue();
      expect(chosenColor).not.toBe("#9955cc");
      await expect(dialog.locator("aside [data-color]")).toHaveAttribute("data-color", chosenColor);
      await picker.getByLabel("HEX", { exact: true }).fill("#xx");
      await expect(picker.getByLabel("HEX", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await hue.focus();
      await expect(picker.getByLabel("HEX", { exact: true })).toHaveValue(chosenColor);
      await page.setViewportSize({ width: 375, height: 850 });
      await picker.scrollIntoViewIfNeeded();
      await expectNoOverflow(page);
      const mobilePicker = (await picker.boundingBox())!;
      expect(mobilePicker.x).toBeGreaterThanOrEqual(12);
      expect(mobilePicker.x + mobilePicker.width).toBeLessThanOrEqual(363);
      expect(mobilePicker.y).toBeGreaterThanOrEqual(12);
      expect(mobilePicker.y + mobilePicker.height).toBeLessThanOrEqual(838);
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-links-custom-mobile-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Custom", exact: true })).toBeFocused();
      await page.setViewportSize({ width: 1600, height: 1000 });
      await dialog.getByRole("button", { name: "Custom", exact: true }).click();
      await scanAccessibility(page,info,`link-dialog-${theme}`);
      await page.screenshot({ path: path.join(os.tmpdir(),`blog-links-editor-${theme}.png`) });
      await picker.evaluate(node => {
        const animate = node.animate.bind(node);
        node.animate = (...args) => {
          const animation = animate(...args);
          if (Array.isArray(args[0]) && args[0].at(-1)?.opacity === 0) animation.pause();
          return animation;
        };
      });
      await picker.getByRole("button", { name: "Close color picker" }).click();
      const exitingPicker = dialog.locator('[popover][data-state="closing"]');
      await expect(exitingPicker).toBeAttached();
      await expect(exitingPicker).toHaveAttribute("inert", "");
      await expect(dialog.getByRole("button", { name: "Custom", exact: true })).toBeFocused();
      await exitingPicker.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
      await expect(exitingPicker).toHaveCount(0);
      await dialog.getByRole("button", { name: "Custom", exact: true }).click();
      await dialog.getByLabel("TITLE", { exact: true }).click();
      await expect(picker).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await dialog.getByRole("button", { name: "Custom", exact: true }).click();
      await expect(picker).toHaveCSS("animation-name", "none");
      await picker.getByRole("button", { name: "Close color picker" }).click();
      await expect(picker).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const createdResponse = page.waitForResponse(response => response.url().endsWith("/api/admin/links") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Save link", exact: true }).click();
      const first: HomepageLink = await (await createdResponse).json(); ids.push(first.id);
      expect(first.color).toBe(chosenColor);
      await expect(dialog).toHaveCount(0);
      await page.getByRole("article", { name: `Links ${theme} 1`, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
      const editDialog = page.getByRole("dialog", { name: "Edit link" });
      await editDialog.getByRole("button", { name: "Custom", exact: true }).click();
      await expect(editDialog.getByLabel("HEX", { exact: true })).toHaveValue(chosenColor);
      await editDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      for (let index=2; index<=6; index++) {
        const response = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: { title: `Links ${theme} ${index}`, description: `Shortcut number ${index}`, url: `https://example.com/${index}`, icon: index%2 ? "code" : "book", color: "blue", visible: true, request_id: crypto.randomUUID() } });
        expect(response.ok()).toBeTruthy(); ids.push((await response.json()).id);
      }
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "+ New Link", exact: true })).toHaveClass("editor-primary-action");
      await page.getByRole("tab", { name: /^Files/ }).click();
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "editor-files-tab");
      await page.getByRole("tab", { name: /^Links/ }).click();
      // Changes made outside this editor session are read on document reload.
      await page.reload();
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
      await expect(cards.first().locator("[data-color]")).toHaveAttribute("data-color", chosenColor);
      const expectedRGB = chosenColor.slice(1).match(/../g)!.map(value => parseInt(value, 16));
      await expect(cards.first().locator("[data-color]")).toHaveCSS("color", `rgb(${expectedRGB.join(", ")})`);
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

test("a conflicting link edit retains the draft and invalidates the list for the next entry", async ({ page }) => {
  const headers = await loginAdmin(page);
  const ids: number[] = [];
  try {
    const fields = { title: "Original link", description: "", url: "", icon: "link", color: "blue", visible: false };
    const created = await page.request.post(`${E2E_API_URL}/admin/links`, { headers, data: { ...fields, request_id: crypto.randomUUID() } });
    expect(created.ok()).toBeTruthy();
    const link: HomepageLink = await created.json();
    ids.push(link.id);
    await page.goto("/editor?tab=links");
    const changed = await page.request.put(`${E2E_API_URL}/admin/links/${link.id}`, { headers, data: { ...fields, title: "Updated elsewhere", version: link.version } });
    expect(changed.ok()).toBeTruthy();
    await page.getByRole("article", { name: "Original link", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit link" });
    await dialog.getByLabel("TITLE", { exact: true }).fill("Unsaved local draft");
    const response = page.waitForResponse(r => r.url().endsWith(`/api/admin/links/${link.id}`) && r.request().method() === "PUT");
    await dialog.getByRole("button", { name: "Save link", exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("TITLE", { exact: true })).toHaveValue("Unsaved local draft");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    let reads = 0;
    await page.route("**/api/admin/links", async route => { reads++; await route.continue(); });
    await page.getByRole("tab", { name: /^Posts/ }).click();
    await page.getByRole("tab", { name: /^Links/ }).click();
    await expect(page.getByRole("article", { name: "Updated elsewhere", exact: true })).toBeVisible();
    expect(reads).toBe(1);
    await page.getByRole("tab", { name: /^Files/ }).click();
    await page.getByRole("tab", { name: /^Links/ }).click();
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
    expect(reads).toBe(1);
  } finally { await clearLinks(page, headers, ids); }
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
  test(`Links share tab transitions and reuse resolved empty results without another read (reduced: ${reducedMotion})`, async ({ page }) => {
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
    let reads = 0;
    await page.route("**/api/admin/links", async route => { reads++; await route.continue(); });
    {
      await page.getByRole("tab", { name: /^Links/ }).click();
      await expect(panel).toHaveAttribute("aria-labelledby", "editor-links-tab");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("button", { name: "+ New Link", exact: true })).toBeEnabled();
      await expect(page.getByText("Loading links…", { exact: true })).toHaveCount(0);
      await page.getByRole("tab", { name: /^Posts/ }).click();
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
      expect(reads).toBe(0);
    }
  });
}

for (const theme of ["dark", "light"]) {
  test(`Links reuse loaded counts, allow drafts during ordering and keep action appearance stable in ${theme}`, async ({ page, context, browser }, info) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const headers = await loginAdmin(page);
    const ids: number[] = [];
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
      let reads = 0;
      await page.route("**/api/admin/links", async route => { reads++; await route.continue(); });
      await linksTab.click();
      await expect(linksTab).toBeVisible();
      expect((await linksTab.boundingBox())!.width).toBe(tabWidth);
      await expect(page.getByRole("article")).toHaveCount(3);
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      expect(reads).toBe(0);
      const newLink = page.getByRole("button", { name: "+ New Link", exact: true });
      const appearance = (node: HTMLElement | SVGElement) => {
        const css = getComputedStyle(node);
        return { opacity: css.opacity, background: css.backgroundColor, color: css.color, border: css.borderColor };
      };
      const beforeNewAppearance = await newLink.evaluate(appearance);
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
      await expect(newLink).toBeEnabled();
      expect(await newLink.evaluate(appearance)).toEqual(beforeNewAppearance);
      await newLink.click();
      const draft = page.getByRole("dialog", { name: "New link" });
      await draft.getByLabel("TITLE", { exact: true }).fill("Draft while ordering");
      await draft.getByLabel("Show on homepage").uncheck();
      await expect(draft.getByRole("button", { name: "Save link", exact: true })).toBeDisabled();
      await expect(draft.getByRole("status")).toContainText("Wait for the current link update");
      await page.screenshot({ path: path.join(os.tmpdir(), `blog-links-pending-draft-${theme}.png`) });
      releaseMove();
      await expect(draft.getByRole("button", { name: "Save link", exact: true })).toBeEnabled();
      await expect(draft.getByLabel("TITLE", { exact: true })).toHaveValue("Draft while ordering");
      await draft.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(draft).toHaveCount(0);
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
    } finally { releaseMove(); await clearLinks(page, headers, ids); }
  });
}
