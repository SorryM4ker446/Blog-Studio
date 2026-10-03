import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./support/test-env";
import { clickAtVisibleCenter } from "./support/file-workflow";

test("administrator can draft, publish, and log out", async ({ page, request }) => {
  const postTitle = `E2E workflow ${Date.now()}`;

  await page.goto("/login?redirect=/settings");
  await page.getByPlaceholder("Username").fill(E2E_ADMIN_USER);
  await page.getByPlaceholder("Password").fill(E2E_ADMIN_PASS);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Settings (Admin)" })).toBeVisible();

  const editorResponse = await page.goto("/editor");
  expect(editorResponse).not.toBeNull();
  const editorHTML = await editorResponse!.text();
  expect(editorHTML).toContain("Content Editor");
  expect(editorHTML).not.toContain("Checking editor access");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();

  const browserShellRequests: string[] = [];
  const trackBrowserShellRequests = (request: Request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && ["/api/settings", "/api/admin/me"].includes(pathname)) {
      browserShellRequests.push(pathname);
    }
  };
  page.on("request", trackBrowserShellRequests);
  const reloadResponse = await page.reload();
  expect(reloadResponse).not.toBeNull();
  expect(await reloadResponse!.text()).not.toContain("Checking editor access");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  expect(browserShellRequests).toEqual([]);
  page.off("request", trackBrowserShellRequests);

  const currentSession = (await page.context().cookies()).find(
    (cookie) => cookie.name === "blog_session" && cookie.path === "/",
  );
  expect(currentSession).toBeDefined();
  await page.context().clearCookies({ name: "blog_session" });
  await page.context().addCookies([{
    name: "blog_session",
    value: currentSession!.value,
    domain: currentSession!.domain,
    path: "/api",
    expires: currentSession!.expires,
    httpOnly: true,
    secure: currentSession!.secure,
    sameSite: currentSession!.sameSite,
  }]);

  const compatibilityRequests: string[] = [];
  page.on("request", trackBrowserShellRequests);
  const compatibilityResponse = await page.reload();
  expect(compatibilityResponse).not.toBeNull();
  expect(await compatibilityResponse!.text()).toContain("Checking editor access");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  await expect(page).toHaveURL(/\/editor\?tab=posts$/);
  await expect(page.getByText("Editor posts could not be loaded", { exact: true })).toHaveCount(0);
  compatibilityRequests.push(...browserShellRequests);
  expect(compatibilityRequests).toContain("/api/admin/me");
  expect((await page.context().cookies()).some(
    (cookie) => cookie.name === "blog_session" && cookie.path === "/" && cookie.value !== "",
  )).toBeTruthy();
  page.off("request", trackBrowserShellRequests);

  await page.getByRole("button", { name: "New Post" }).click();
  await page.getByLabel("POST TITLE").fill(postTitle);
  await page.getByLabel("INTRODUCTION").fill("Automated workflow summary");
  await page.locator(".custom-editor-wrapper textarea").fill("# Automated workflow\n\nCreated by Playwright.");
  const retryCategoriesButton = page.getByRole("button", { name: "Try again" });
  if (await retryCategoriesButton.isVisible()) {
    await retryCategoriesButton.click();
  }
  await page.getByRole("combobox", { name: "Post category" }).click();
  await page.getByRole("option", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved successfully!", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  const publicDraftSearch = await request.get(`${E2E_API_URL}/search`, {
    params: { q: postTitle, scope: "posts" },
  });
  expect(publicDraftSearch.ok()).toBeTruthy();
  const draftSearchResult = await publicDraftSearch.json();
  expect(draftSearchResult.posts).toHaveLength(0);

  await page.getByRole("button", { name: "Back to content list" }).click();
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  await clickAtVisibleCenter(page, page.getByText(postTitle, { exact: true }));
  const saveButton = page.getByRole("button", { name: "Publish", exact: true });
  const initialSaveButtonBox = await saveButton.boundingBox();
  expect(initialSaveButtonBox).not.toBeNull();
  const sidebarNav = page.locator(".sidebar .nav-menu");
  await sidebarNav.evaluate((element) => { element.setAttribute("data-save-stability", "preserved"); });
  await page.evaluate(() => {
    const trackedWindow = window as typeof window & { saveSidebarTransitionCount?: number };
    trackedWindow.saveSidebarTransitionCount = 0;
    document.addEventListener("transitionrun", (event) => {
      if (event.target instanceof Element && event.target.closest(".sidebar")) {
        trackedWindow.saveSidebarTransitionCount = (trackedWindow.saveSidebarTransitionCount || 0) + 1;
      }
    });
  });
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route(/\/api\/admin\/posts\/\d+\/publish$/, async (route) => {
    await saveGate;
    await route.continue();
  }, { times: 1 });
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Publishing…" })).toBeVisible();
  const savingButtonBox = await page.getByRole("button", { name: "Publishing…" }).boundingBox();
  expect(savingButtonBox).not.toBeNull();
  expect(savingButtonBox!.width).toBeCloseTo(initialSaveButtonBox!.width, 1);
  await expect(sidebarNav).toHaveAttribute("data-save-stability", "preserved");
  releaseSave();
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(sidebarNav).toHaveAttribute("data-save-stability", "preserved");
  expect(await page.evaluate(
    () => (window as typeof window & { saveSidebarTransitionCount?: number }).saveSidebarTransitionCount || 0,
  )).toBe(0);

  await page.goto("/posts");
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  const postsSearch = page.getByPlaceholder("Search posts...");
  await postsSearch.fill(postTitle);
  await postsSearch.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(postTitle);
  await postsSearch.fill("");
  expect(new URL(page.url()).searchParams.get("q")).toBe(postTitle);
  await postsSearch.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
  await expect.poll(() => postsSearch.evaluate((element: HTMLInputElement) => ({
    focused: document.activeElement === element,
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd,
  }))).toEqual({ focused: true, selectionStart: 0, selectionEnd: 0 });

  await page.addStyleTag({
    content: "html.e2e-tall-post-list section[aria-label='Posts'] { padding-top: 1600px !important; }",
  });
  await page.evaluate(() => document.documentElement.classList.add("e2e-tall-post-list"));
  const postsScrollContainer = page.locator(".content-scroll");
  const postLink = page.getByText(postTitle, { exact: true });
  await postLink.scrollIntoViewIfNeeded();
  const postsScrollPosition = await postsScrollContainer.evaluate((element) => element.scrollTop);
  expect(postsScrollPosition).toBeGreaterThan(500);

  await postLink.click();
  await expect(page.getByRole("heading", { name: postTitle })).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/\d+$/);
  await expect.poll(() => postsScrollContainer.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(() => page.evaluate(() => ({ url: history.state.blogNavigation?.url, returnTo: history.state.blogNavigation?.returnTo }))).toEqual({ url: new URL(page.url()).pathname, returnTo: "/posts" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/posts$/);
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  await expect.poll(() => postsScrollContainer.evaluate((element) => element.scrollTop)).toBe(postsScrollPosition);
  await page.evaluate(() => document.documentElement.classList.remove("e2e-tall-post-list"));

  const homeResponse = await page.goto("/");
  expect(homeResponse).not.toBeNull();
  expect(await homeResponse!.text()).toContain(postTitle);
  const categoryToggle = page.getByRole("button", { name: "Toggle categories" });
  await categoryToggle.click();
  await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");

  const browserRecentPostRequests: string[] = [];
  const trackRecentPostRequests = (request: Request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/posts") {
      browserRecentPostRequests.push(request.url());
    }
  };
  page.on("request", trackRecentPostRequests);
  const expandedHomeResponse = await page.reload();
  expect(expandedHomeResponse).not.toBeNull();
  expect(await expandedHomeResponse!.text()).toContain(postTitle);
  await expect(page.getByRole("button", { name: "Toggle categories" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "Content Editor" })).toBeVisible();
  expect(browserRecentPostRequests).toEqual([]);
  page.off("request", trackRecentPostRequests);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Log Out Securely" }).click();
  await page.getByRole("button", { name: "Log Out", exact: true }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page).toHaveURL(/\/login\?redirect=%2Feditor|\/login\?redirect=\/editor/);
});

