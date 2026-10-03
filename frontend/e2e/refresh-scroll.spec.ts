import { expect, test } from "@playwright/test";
import { loginAdmin } from "./support/auth";
import { E2E_API_URL } from "./support/test-env";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`refresh resets all scroll regions with ${reducedMotion} motion`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1500, height: 850 });
    await page.emulateMedia({ reducedMotion });
    const headers = await loginAdmin(page);
    const content = Array.from({ length: 150 }, (_, index) => `Paragraph ${index} for scrolling.\n\n`).join("");
    const post = await (await page.request.post(`${E2E_API_URL}/admin/posts`, { headers,
      data: { title: "Refresh scroll", content } })).json();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
    try {
      await page.goto(`/editor?edit=${post.id}`);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      const scrollDown = () => page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("*")).filter(element => element.scrollHeight > element.clientHeight + 100);
        nodes.forEach(element => { element.scrollTop = 200; });
        return nodes.filter(element => element.scrollTop > 0).length;
      });
      expect(await scrollDown()).toBeGreaterThanOrEqual(3);
      await page.reload();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => Array.from(document.querySelectorAll("*")).every(element => !element.scrollTop))).toBe(true);
      expect(await scrollDown()).toBeGreaterThanOrEqual(3);
      await page.evaluate(() => {
        const frames: number[][] = [];
        const nodes = Array.from(document.querySelectorAll("*")).filter(element => element.scrollTop > 0);
        const sample = () => { frames.push(nodes.map(element => element.scrollTop)); requestAnimationFrame(sample); };
        sample();
        window.addEventListener("beforeunload", () => {
          frames.push(nodes.map(element => element.scrollTop));
          sessionStorage.setItem("refreshScrollFrames", JSON.stringify(frames));
        }, { once: true });
      });
      await Promise.all([
        page.waitForEvent("domcontentloaded"),
        page.getByRole("button", { name: "Refresh page", exact: true }).click(),
      ]);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      const frames: number[][] = await page.evaluate(() => JSON.parse(sessionStorage.getItem("refreshScrollFrames")!));
      await info.attach("refresh-scroll-frames", { body: JSON.stringify(frames), contentType: "application/json" });
      expect(frames.at(-1)!.every(value => value === 0)).toBe(true);
      if (reducedMotion === "no-preference") {
        expect(new Set(frames.map(frame => Math.round(frame[0]))).size).toBeGreaterThan(4);
        expect(frames.slice(1).every((frame, index) => frame.every((value, node) => value <= frames[index][node]))).toBe(true);
      }
      expect(await page.evaluate(() => Array.from(document.querySelectorAll("*")).every(element => !element.scrollTop))).toBe(true);
      expect(errors).toEqual([]);
    } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
  });
}
