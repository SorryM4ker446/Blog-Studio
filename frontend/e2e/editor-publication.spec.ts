import { answerLeaveDialog } from "./support/editor-navigation";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";

test("article publication protects local edits and rejects stale browser tabs", async ({ page, context }) => {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers: { "X-CSRF-Token": (await csrf.json()).csrf_token },
    data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await login.json()).csrf_token };
  const title = `Publication ${Date.now()}`;
  let id = 0;
  let creates = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/posts") creates++; });
  const other = await context.newPage();
  other.on("dialog", dialog => dialog.accept());
  try {
    await page.goto("/editor?tab=posts&edit=new");
    await page.getByLabel("POST TITLE").fill(title);
    await page.locator(".custom-editor-wrapper textarea").fill("Original saved body");
    await page.route("**/api/admin/posts/*/publish", route => route.fulfill({ status: 503, json: { error: "Publication unavailable" } }), { times: 1 });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.locator("#post-save-message")).toContainText("Draft created; publication failed");
    id = Number(new URL(page.url()).searchParams.get("edit"));
    expect(id).toBeGreaterThan(0);
    expect(creates).toBe(1);
    const initial = await page.request.get(`${E2E_API_URL}/admin/posts/${id}`);
    expect(await initial.json()).toMatchObject({ status: "draft", version: 1 });

    await other.goto(`/editor?tab=posts&edit=${id}`);
    const otherBody = other.locator(".custom-editor-wrapper textarea");
    await otherBody.fill("Text from the older tab");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
    expect(creates).toBe(1);
    const conflictResponse = other.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith(`/posts/${id}`));
    await other.getByRole("button", { name: "Save", exact: true }).click();
    const conflict = await conflictResponse;
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "post_version_conflict" });
    await expect(otherBody).toHaveValue("Text from the older tab");
    await expect(other.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await other.getByRole("button", { name: "Load latest version", exact: true }).click();
    await expect(other.getByLabel("Latest saved content")).toHaveValue("Original saved body");
    await expect(otherBody).toHaveValue("Text from the older tab");
    await other.getByRole("button", { name: "Discard my edits and use latest" }).click();
    await expect(otherBody).toHaveValue("Original saved body");
    await expect(other.getByRole("link", { name: "View article" })).toHaveAttribute("href", new RegExp(`/posts/${id}\\?returnTo=`));

    await otherBody.fill("Unsaved withdrawal text");
    const editURL = other.url();
    const tabs = context.pages().length;
    await other.getByRole("link", { name: "View article" }).click();
    await answerLeaveDialog(other, true);
    await expect(other.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(context.pages().length).toBe(tabs);
    expect(new URL(other.url()).pathname).toBe(`/posts/${id}`);
    await other.getByRole("button", { name: "Back", exact: true }).click();
    await expect(other).toHaveURL(editURL);
    await other.getByRole("button", { name: "Restore copy 1", exact: true }).click();
    await expect(otherBody).toHaveValue("Unsaved withdrawal text");
    await expect(other.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await other.getByRole("link", { name: "View article" }).click();
    await answerLeaveDialog(other, true);
    await expect(other.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await other.goBack();
    await other.getByRole("button", { name: "Restore copy 1", exact: true }).click();
    await expect(otherBody).toHaveValue("Unsaved withdrawal text");
    await other.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(other.locator("#post-save-message")).toContainText("Publication withdrawn");
    await expect(otherBody).toHaveValue("Unsaved withdrawal text");
    await expect(other.getByText("Unsaved changes", { exact: true })).toBeVisible();
    const withdrawn = await page.request.get(`${E2E_API_URL}/admin/posts/${id}`);
    expect(await withdrawn.json()).toMatchObject({ status: "draft", version: 3, content: "Original saved body" });
    expect((await page.request.get(`${E2E_API_URL}/posts/${id}`)).status()).toBe(404);

    await other.route(`**/api/admin/posts/${id}`, async route => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({ status: 401, json: { code: "invalid_session", error: "Expired" } });
    }, { times: 1 });
    await other.getByRole("button", { name: "Save", exact: true }).click();
    await expect(other.getByRole("link", { name: "Sign in in a new tab" })).toBeVisible();
    await expect(other).toHaveURL(new RegExp(`edit=${id}`));
    await expect(otherBody).toHaveValue("Unsaved withdrawal text");
    await other.getByRole("button", { name: "Save", exact: true }).click();
    await expect(other.getByText("All changes saved", { exact: true })).toBeVisible();
    const saved = await page.request.get(`${E2E_API_URL}/admin/posts/${id}`);
    expect(await saved.json()).toMatchObject({ status: "draft", version: 4, content: "Unsaved withdrawal text" });
    await other.reload();
    await expect(otherBody).toHaveValue("Unsaved withdrawal text");
  } finally {
    await other.close();
    if (id) await page.request.delete(`${E2E_API_URL}/admin/posts/${id}`, { headers });
  }
});
