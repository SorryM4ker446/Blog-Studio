import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/accessibility";
import { E2E_APP_URL } from "./support/test-env";

for (const theme of ["dark", "light"]) {
  test(`failed link saves and retries preserve dialog geometry in ${theme}`, async ({ page, context }) => {
    await context.addCookies([{ name: "blog_theme", value: theme, url: E2E_APP_URL }]);
    await loginAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/editor?tab=links");
    await page.getByRole("button", { name: "+ New Link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New link" });
    await dialog.getByLabel("TITLE", { exact: true }).fill("Save validation");
    await dialog.getByLabel("DESTINATION URL", { exact: true }).fill("http://localhost:3000/editor?tab=links1");
    const save = dialog.getByRole("button", { name: "Save link", exact: true });
    await save.hover();
    await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const shape = () => dialog.evaluate(node => {
      const button = node.querySelector('button[type="submit"]')!;
      const rect = node.getBoundingClientRect(), b = button.getBoundingClientRect(), css = getComputedStyle(button);
      return { x:rect.x, y:rect.y, width:rect.width, height:rect.height, bx:b.x, by:b.y, bw:b.width, bh:b.height, opacity:css.opacity, background:css.backgroundColor, scroll:node.scrollTop };
    });
    const baseline = await shape();
    let release = () => {};
    await page.route("**/api/admin/links", async route => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status:400, contentType:"application/json", body:JSON.stringify({ error:"Check the link fields and version" }) });
    });
    await page.evaluate(() => {
      const state = { running:true, frames:[] as number[][] };
      (window as unknown as { saveMonitor: typeof state }).saveMonitor = state;
      const sample = () => {
        const node = document.querySelector('[data-modal-panel]')!;
        const rect = node.getBoundingClientRect();
        state.frames.push([rect.x, rect.y, rect.width, rect.height, Number(getComputedStyle(node).opacity), Number(getComputedStyle(node.parentElement!).opacity)]);
        if (state.running) requestAnimationFrame(sample);
      };
      sample();
    });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const request = page.waitForRequest(req => req.url().endsWith("/api/admin/links") && req.method() === "POST");
        await save.click(); await request;
        await expect(dialog).toHaveAttribute("aria-busy", "true");
        await expect(save).toBeDisabled();
        await expect(save).toHaveText("Save link");
        expect(await shape()).toEqual(baseline);
        if (attempt) await expect(dialog.getByRole("alert")).toHaveText("Check the link fields and version");
        release();
        await expect(dialog).toHaveAttribute("aria-busy", "false");
        await expect(dialog.getByRole("alert")).toHaveText("Check the link fields and version");
        expect(await shape()).toEqual(baseline);
      }
      const frames = await page.evaluate(() => {
        const state = (window as unknown as { saveMonitor: { running:boolean; frames:number[][] } }).saveMonitor;
        state.running = false; return state.frames;
      });
      expect(frames.length).toBeGreaterThan(2);
      for (const frame of frames) expect(frame).toEqual([baseline.x, baseline.y, baseline.width, baseline.height, 1, 1]);
    } finally { release(); }
  });
}
