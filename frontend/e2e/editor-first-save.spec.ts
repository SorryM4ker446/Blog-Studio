import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

for (const entry of ["direct", "list"]) test(`creating a draft from ${entry} preserves the visible form through its saved URL handoff`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const csrf = await (await page.request.get(`${E2E_API_URL}/csrf`)).json();
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": csrf.csrf_token }, data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  await page.goto(entry === "direct" ? "/editor?edit=new" : "/editor");
  if (entry === "list") await page.getByRole("button", { name: "+ New Post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("First save continuity");
  const textarea = page.locator(".custom-editor-wrapper textarea");
  await textarea.fill("Keep this editor mounted throughout the first save.");
  await expect(page.locator(".editor-save-button")).toBeEnabled();
  await page.locator(".editor-save-button").scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("[data-editor-view]").evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#post-title, .custom-editor-wrapper textarea, .editor-save-button")];
    const problems = new Set<string>();
    const top = document.querySelector(".editor-form-header")!.getBoundingClientRect().top;
    const frames: unknown[] = [];
    let frame = 0;
    const sample = () => {
      if (nodes.some(node => !node.isConnected)) problems.add("form detached");
      if (document.querySelector('#post-title') instanceof HTMLInputElement && !(document.querySelector('#post-title') as HTMLInputElement).value) problems.add("title cleared");
      const header = document.querySelector(".editor-form-header");
      if (header && Math.abs(header.getBoundingClientRect().top - top) > 1) problems.add("header shifted");
      let opacity = 1;
      for (let node: Element | null = document.querySelector("#post-title"); node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (opacity < 0.99) problems.add("form faded");
      frames.push({ url: location.search, opacity, top: header?.getBoundingClientRect().top, text: document.querySelector(".editor-save-state")?.textContent,
        animations: document.getAnimations().map(a => ({ frames: (a.effect as KeyframeEffect)?.getKeyframes(), target: ((a.effect as KeyframeEffect)?.target as Element)?.className })) });
    };
    const tick = () => { sample(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    Object.assign(window, { saveContinuity: () => { observer.disconnect(); cancelAnimationFrame(frame); return { problems: [...problems], frames }; } });
  });
  let id: string | null = null;
  try {
    await page.locator(".editor-save-button").click();
    await expect(page).toHaveURL(/edit=\d+/);
    id = new URL(page.url()).searchParams.get("edit");
    await expect(page.locator(".editor-save-button")).toBeEnabled();
    await expect(textarea).toHaveValue("Keep this editor mounted throughout the first save.");
    const evidence = await page.evaluate(() => (window as unknown as { saveContinuity: () => { problems: string[]; frames: unknown[] } }).saveContinuity());
    await testInfo.attach("save-frames", { body: JSON.stringify(evidence), contentType: "application/json" });
    expect(evidence.problems).toEqual([]);
    await textarea.fill("A second version");
    await page.locator(".editor-save-button").click();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (id) await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
  }
});
