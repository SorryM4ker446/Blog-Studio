import { answerLeaveDialog } from "./support/editor-navigation";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL, E2E_APP_URL } from "./support/test-env";

async function login(page: Page) {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const response = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(response.ok()).toBeTruthy();
  return { "X-CSRF-Token": (await response.json()).csrf_token };
}
async function copies(page: Page) {
  return page.evaluate(() => new Promise<{ id: string; target: string; tab: string; updatedAt: number; fields: { title: string; content: string } }[]>((resolve, reject) => {
    const request = indexedDB.open("blog-studio-editor-recovery", 1);
    request.onerror = () => reject(new Error("Unable to inspect test copies"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("copies")) { db.close(); resolve([]); return; }
      const tx = db.transaction("copies"), read = tx.objectStore("copies").getAll();
      read.onsuccess = () => resolve(read.result);
      tx.oncomplete = () => db.close();
    };
  }));
}
const body = (page: Page) => page.locator(".custom-editor-wrapper textarea");
async function restore(page: Page, title?: string) {
  const notice = page.getByRole("region", { name: "Browser recovery" });
  if (title) await notice.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: /Restore copy/ }).click();
  else await notice.getByRole("button", { name: "Restore copy 1", exact: true }).click();
}

test("continuing the saved version keeps the previous browser copy recoverable", async ({ page }) => {
  const headers = await login(page);
  const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title: "Keep previous browser copy", content: "Server content" } });
  const post = await response.json();
  page.on("dialog", dialog => dialog.accept());
  try {
    await page.goto(`/editor?edit=${post.id}`);
    await body(page).fill("Previous unsaved content");
    await expect.poll(async () => (await copies(page)).some(copy => copy.fields.content === "Previous unsaved content")).toBe(true);
    await page.reload();
    const notice = page.getByRole("region", { name: "Browser recovery" });
    await expect(notice).toBeVisible();
    await expect(page.getByLabel("POST TITLE")).toBeDisabled();
    await expect(page.getByText("Choose a recovery option above", { exact: true })).toBeVisible();
    await notice.getByRole("button", { name: "Keep copies and continue" }).click();
    await expect(notice).toHaveCount(0);
    await expect(body(page)).toHaveValue("Server content");
    await body(page).fill("New saved content");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    expect((await copies(page)).some(copy => copy.fields.content === "Previous unsaved content")).toBe(true);
    await page.reload();
    await restore(page);
    await expect(body(page)).toHaveValue("Previous unsaved content");
    const saved = await page.request.get(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    expect((await saved.json()).content).toBe("New saved content");
  } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
});

test("cancelled links and history preserve the editor and refresh recovery never writes articles", async ({ page }) => {
  const headers = await login(page);
  const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title: `Recovery navigation ${Date.now()}`, content: "Server body" } });
  const post = await response.json();
  let proceed = false, dialogs = 0, writes = 0;
  page.on("dialog", dialog => { dialogs++; return proceed ? dialog.accept() : dialog.dismiss(); });
  page.on("request", request => { if (/\/api\/admin\/posts(?:\/|$)/.test(new URL(request.url()).pathname) && ["POST", "PUT"].includes(request.method())) writes++; });
  try {
    await page.goto(`/editor?tab=posts&q=${encodeURIComponent(post.title)}`);
    await page.getByRole("button", { name: `Open ${post.title}`, exact: true }).click();
    await body(page).fill("Unsaved text\n".repeat(80));
    await expect.poll(async () => (await copies(page)).length).toBe(1);
    const url = page.url();
    await page.locator(".content-scroll").evaluate(element => { element.scrollTop = 180; });
    const state = await page.evaluate(() => JSON.stringify(history.state));
    const scroll = await page.locator(".content-scroll").evaluate(element => element.scrollTop);
    await page.getByRole("button", { name: "Back to content list" }).evaluate(element => (element as HTMLButtonElement).click());
    await answerLeaveDialog(page, false);
    await expect(page).toHaveURL(url);
    expect(await page.locator(".content-scroll").evaluate(element => element.scrollTop)).toBe(scroll);
    await page.locator('aside a[href="/drive"]').click();
    await answerLeaveDialog(page, false);
    await expect(page).toHaveURL(url);
    await page.evaluate(() => history.back());
    await answerLeaveDialog(page, false);
    await expect(page).toHaveURL(url);
    expect(await page.evaluate(() => JSON.stringify(history.state))).toBe(state);
    expect(await page.locator(".content-scroll").evaluate(element => element.scrollTop)).toBe(scroll);
    await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    // Move the scroll container again after cancellation to ensure saving was not frozen.
    await page.locator(".content-scroll").evaluate(element => { element.scrollTop = 160; });
    await expect.poll(() => page.locator(".content-scroll").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(scroll).toBeGreaterThan(0);
    proceed = true;
    await page.evaluate(() => history.back());
    await answerLeaveDialog(page, true);
    await expect(page.getByRole("heading", { name: "Content Editor", exact: true })).toBeVisible();
    await page.goForward(); await restore(page);
    await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    proceed = false;
    const beforeReload = dialogs;
    await page.evaluate(() => location.reload());
    await expect.poll(() => dialogs).toBe(beforeReload + 1);
    await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    await expect(page).toHaveURL(url);
    proceed = true;
    await expect.poll(async () => (await copies(page)).some(copy => copy.fields.content.startsWith("Unsaved"))).toBe(true);
    await page.reload(); await restore(page);
    await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    expect(writes).toBe(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: test.info().outputPath("restored-editor.png"), fullPage: true });
    expect((await (await page.request.get(`${E2E_API_URL}/admin/posts/${post.id}`)).json()).content).toBe("Server body");
    await page.locator('aside a[href="/drive"]').click();
    await answerLeaveDialog(page, true);
    await expect(page).toHaveURL("/drive");
    await page.goBack(); await restore(page);
    proceed = false;
    await page.evaluate(() => history.forward());
    await answerLeaveDialog(page, false);
    await expect(page).toHaveURL(url);
    await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    proceed = true;
    await page.evaluate(() => history.forward());
    await answerLeaveDialog(page, true);
    await expect(page).toHaveURL("/drive");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Browser recovery" })).toBeVisible();
    const offered = (await copies(page)).sort((a, b) => b.updatedAt - a.updatedAt);
    const retainedIDs = offered.slice(1).map(copy => copy.id).sort();
    await restore(page);
    expect(writes).toBe(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    // Save clears the chosen source and current edit, preserving unselected alternatives.
    await expect.poll(async () => (await copies(page)).map(copy => copy.id).sort()).toEqual(retainedIDs);
    await page.reload(); await expect(body(page)).toHaveValue("Unsaved text\n".repeat(80));
    await page.getByRole("button", { name: "Keep copies and continue" }).click();
    await expect(page.getByRole("region", { name: "Browser recovery" })).toHaveCount(0);
    expect((await copies(page)).map(copy => copy.id).sort()).toEqual(retainedIDs);
    expect(writes).toBe(1);
  } finally { await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
});

test("closed new drafts remain discoverable and duplicated tabs cannot share copy ownership", async ({ page, context }) => {
  const headers = await login(page);
  let closeAllowed = false;
  page.on("dialog", dialog => closeAllowed ? dialog.accept() : dialog.dismiss());
  await page.goto("/editor?tab=posts&edit=new");
  await page.getByLabel("POST TITLE").fill("Closed unsaved draft"); await body(page).fill("Retain after closing");
  await expect.poll(async () => (await copies(page)).length).toBe(1);
  await page.close({ runBeforeUnload: true });
  expect(page.isClosed()).toBe(false);
  closeAllowed = true;
  const closed = page.waitForEvent("close"); await page.close({ runBeforeUnload: true }); await closed;
  const reopened = await context.newPage(); reopened.on("dialog", dialog => dialog.accept());
  let duplicate: Page | undefined;
  try {
    await reopened.goto("/editor?tab=posts&edit=new");
    await expect(reopened.getByRole("region", { name: "Browser recovery" })).toContainText("Closed unsaved draft");
    await reopened.getByRole("button", { name: "Discard browser copies" }).click();
    await expect.poll(async () => (await copies(reopened)).length).toBe(0);
    await reopened.getByLabel("POST TITLE").fill("Original duplicated draft"); await body(reopened).fill("Original tab copy");
    await expect.poll(async () => (await copies(reopened)).length).toBe(1);
    const opened = context.waitForEvent("page"); await reopened.evaluate(() => window.open(location.href, "_blank")); duplicate = await opened;
    duplicate.on("dialog", dialog => dialog.accept());
    await restore(duplicate);
    await duplicate.getByLabel("POST TITLE").fill("Independent duplicated draft"); await body(duplicate).fill("Duplicate tab copy");
    await expect.poll(async () => (await copies(reopened)).length).toBe(2);
    expect(new Set((await copies(reopened)).map(copy => copy.tab)).size).toBe(2);
    await duplicate.getByRole("button", { name: "Save", exact: true }).click();
    await expect(duplicate.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await copies(reopened)).length).toBe(1);
    expect((await copies(reopened))[0].fields.content).toBe("Original tab copy");
    const id = new URL(duplicate.url()).searchParams.get("edit");
    await duplicate.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
  } finally { await duplicate?.close(); await reopened.close(); }
});

test("separate tabs keep independent copies and restoring an older version requires conflict review", async ({ page, context }) => {
  const headers = await login(page);
  const response = await page.request.post(`${E2E_API_URL}/admin/posts`, { headers, data: { title: `Recovery tabs ${Date.now()}`, content: "Server baseline" } });
  const post = await response.json(); const other = await context.newPage();
  page.on("dialog", dialog => dialog.accept()); other.on("dialog", dialog => dialog.accept());
  try {
    const url = `/editor?tab=posts&edit=${post.id}`;
    await page.goto(url); await other.goto(url);
    await page.getByLabel("POST TITLE").fill("Copy from first tab"); await body(page).fill("First tab text");
    await other.getByLabel("POST TITLE").fill("Copy from second tab"); await body(other).fill("Second tab text");
    await expect.poll(async () => (await copies(page)).length).toBe(2);
    expect(new Set((await copies(page)).map(copy => copy.tab)).size).toBe(2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await copies(page)).length).toBe(1);
    await other.reload(); await restore(other, "Copy from second tab");
    await expect(body(other)).toHaveValue("Second tab text");
    await expect(other.getByRole("region", { name: "Article version conflict" })).toBeVisible();
    await expect(other.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(other.getByLabel("Latest saved content")).toHaveValue("First tab text");
    await other.getByRole("button", { name: "Discard my edits and use latest" }).click();
    await expect(body(other)).toHaveValue("First tab text");
    await expect.poll(async () => (await copies(other)).length).toBe(0);
  } finally { await other.close(); await page.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers }); }
});

test("expired sessions preserve a new draft and confirmed logout clears copies across tabs", async ({ page, context }) => {
  await login(page); page.on("dialog", dialog => dialog.accept());
  await page.goto("/editor?tab=posts&edit=new");
  await page.getByLabel("POST TITLE").fill("Unsubmitted recovery draft");
  await body(page).fill("Keep through expired session");
  const url = page.url(); expect(new URL(url).searchParams.get("draft")).toBeTruthy();
  await page.route("**/api/admin/categories", route => route.fulfill({ status: 401, json: { code: "invalid_session", error: "Expired" } }), { times: 1 });
  await page.getByRole("button", { name: "Create category", exact: true }).click();
  await page.getByPlaceholder("New category name…").fill("Expired request");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(async () => (await copies(page)).length).toBe(1);
  await login(page); await page.goto(url); await restore(page);
  await expect(body(page)).toHaveValue("Keep through expired session");
  const other = await context.newPage();
  try {
    await other.goto("/settings");
    await other.route("**/api/admin/logout", route => route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }), { times: 1 });
    await other.getByRole("button", { name: "Log Out Securely", exact: true }).click();
    await other.getByRole("dialog").getByRole("button", { name: "Log Out", exact: true }).click();
    await expect(other.getByRole("button", { name: "Try Logout Again" })).toBeVisible();
    expect((await copies(other)).length).toBeGreaterThan(0);
    await other.getByRole("button", { name: "Try Logout Again" }).click();
    await other.getByRole("dialog").getByRole("button", { name: "Log Out", exact: true }).click();
    await expect(other).toHaveURL("/");
    await expect.poll(async () => (await copies(other)).length).toBe(0);
    await expect(page).toHaveURL(/\/login/);
    await page.waitForTimeout(1200);
    expect(await copies(other)).toEqual([]);
  } finally { await other.close(); }
});

test("unavailable storage leaves manual saving usable", async ({ page }) => {
  const headers = await login(page); page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { configurable: true, get: () => { throw new DOMException("Denied", "SecurityError"); } }); });
  await page.goto("/editor?tab=posts&edit=new");
  await expect(page.getByRole("alert").filter({ hasText: "Browser recovery is unavailable" })).toBeVisible();
  await page.getByLabel("POST TITLE").fill(`Storage unavailable ${Date.now()}`); await body(page).fill("Manual save still works");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("edit");
  expect(Number(id)).toBeGreaterThan(0);
  await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
});

test("restarted browsers retain article recovery through authentication renewal without logout", async ({ playwright }, testInfo) => {
  const profile = testInfo.outputPath("browser-profile");
  let context = await playwright.chromium.launchPersistentContext(profile, { headless: true, baseURL: E2E_APP_URL });
  const page = context.pages()[0];
  let headers = await login(page);
  const created = await page.request.post(`${E2E_API_URL}/admin/posts`, {
    headers, data: { title: `Restarted browser recovery ${Date.now()}`, content: "Published server content" },
  });
  expect(created.status()).toBe(201);
  const post = await created.json();
  const published = await page.request.post(`${E2E_API_URL}/admin/posts/${post.id}/publish`, {
    headers, data: { version: post.version },
  });
  expect(published.ok()).toBeTruthy();
  let writes = 0;
  const watchWrites = () => context.on("request", request => {
    if (["POST", "PUT"].includes(request.method()) && request.url().includes("/api/admin/posts")) writes++;
  });
  watchWrites();
  page.on("dialog", dialog => { expect(dialog.type()).toBe("beforeunload"); void dialog.accept(); });
  try {
    await page.goto(`/editor?tab=posts&edit=${post.id}`);
    await body(page).fill("Unsaved published article text retained after browser restart");
    await expect.poll(async () => (await copies(page)).some(copy => copy.target === `post:${post.id}`
      && copy.fields.content === "Unsaved published article text retained after browser restart")).toBe(true);
    const closed = page.waitForEvent("close");
    await page.close({ runBeforeUnload: true }); await closed;
    await context.close();
    // Restart the actual browser process against the same disposable disk
    // profile. Losing cookies requires login but must not remove IndexedDB.
    context = await playwright.chromium.launchPersistentContext(profile, { headless: true, baseURL: E2E_APP_URL });
    watchWrites();
    await context.clearCookies();
    const reopened = context.pages()[0];
    await reopened.goto("/login");
    headers = await login(reopened);
    await reopened.goto(`/editor?tab=posts&q=${encodeURIComponent(post.title)}`);
    await reopened.getByRole("article").filter({ hasText: post.title }).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(reopened.getByRole("region", { name: "Browser recovery" })).toBeVisible();
    await restore(reopened);
    await expect(body(reopened)).toHaveValue("Unsaved published article text retained after browser restart");
    expect(writes).toBe(0);
    const serverPost = await reopened.request.get(`${E2E_API_URL}/admin/posts/${post.id}`);
    expect((await serverPost.json()).content).toBe("Published server content");
  } finally {
    await context.request.delete(`${E2E_API_URL}/admin/posts/${post.id}`, { headers });
    await context.close();
  }
});
