import { expect, test } from "@playwright/test";
import type { Locator, Page, Request } from "@playwright/test";
import {
  E2E_ADMIN_PASS,
  E2E_ADMIN_USER,
  E2E_API_URL,
} from "./support/test-env";

const onePixelPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const driveFileSearchRoute = { apiPath: "/api/search", pagePath: "/drive" };
const editorFileSearchRoute = {
  apiPath: "/api/admin/search",
  pagePath: "/editor",
  tab: "files" as const,
};

async function submitFileSearchAndWait(
  page: Page,
  input: Locator,
  query: string,
  expected: { apiPath: string; pagePath: string; tab?: "files" },
) {
  await input.fill(query);
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === expected.apiPath
      && url.searchParams.get("scope") === "files"
      && url.searchParams.get("q") === query;
  });

  await input.press("Enter");
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      pathname: url.pathname,
      tab: url.searchParams.get("tab"),
      query: url.searchParams.get("q"),
    };
  }).toEqual({ pathname: expected.pagePath, tab: expected.tab || null, query });

  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(input).toHaveValue(query);
  await expect.poll(() => input.evaluate((element: HTMLInputElement) => ({
    focused: document.activeElement === element,
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd,
  }))).toEqual({
    focused: true,
    selectionStart: query.length,
    selectionEnd: query.length,
  });
}

async function selectPublicationStatus(page: Page, option: "Draft" | "Published") {
  await page.getByRole("combobox", { name: "Publication status" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function clickAtVisibleCenter(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

function waitForEditorLists(page: Page) {
  const paths = ["/api/admin/categories", "/api/admin/posts", "/api/admin/files"];
  return Promise.all(paths.map((path) => page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === path;
  }))).then((responses) => {
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }
  });
}

test("administrator can draft, publish, and log out", async ({ page, request }) => {
  const postTitle = `E2E workflow ${Date.now()}`;

  await page.goto("/login?redirect=/settings");
  await page.getByPlaceholder("Username").fill(E2E_ADMIN_USER);
  await page.getByPlaceholder("Password").fill(E2E_ADMIN_PASS);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "Content Editor" })).toBeVisible();
  await page.getByRole("button", { name: "+ New Post" }).click();
  await page.getByLabel("POST TITLE").fill(postTitle);
  await page.getByLabel("INTRODUCTION").fill("Automated workflow summary");
  await page.locator(".custom-editor-wrapper textarea").fill("# Automated workflow\n\nCreated by Playwright.");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  const publicDraftSearch = await request.get(`${E2E_API_URL}/search`, {
    params: { q: postTitle, scope: "posts" },
  });
  expect(publicDraftSearch.ok()).toBeTruthy();
  const draftSearchResult = await publicDraftSearch.json();
  expect(draftSearchResult.posts).toHaveLength(0);

  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  await clickAtVisibleCenter(page, page.getByText(postTitle, { exact: true }));
  await selectPublicationStatus(page, "Published");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  await page.goto("/posts");
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Log Out Securely" }).click();
  await page.getByRole("button", { name: "Log Out", exact: true }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page).toHaveURL(/\/login\?redirect=%2Feditor|\/login\?redirect=\/editor/);
});

test("administrator can publish an uploaded image and safely remove it after references are cleared", async ({ page }) => {
  const unique = Date.now();
  const postTitle = `E2E image lifecycle ${unique}`;
  const imageName = `e2e-image-${unique}.png`;
  const displayName = `Launch image ${unique} with a long display name that must not overlap file actions.png`;
  const updatedDisplayName = `Updated launch image ${unique} with a long display name that remains safely truncated.png`;
  const fileDescription = `Public image metadata ${unique}`;
  const imageAlt = `Uploaded image ${unique}`;

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await page.getByPlaceholder("Username").fill(E2E_ADMIN_USER);
  await page.getByPlaceholder("Password").fill(E2E_ADMIN_PASS);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/editor");
  await expect(page.locator(".content-scroll")).toHaveCSS(
    "scrollbar-color",
    "rgb(95, 99, 104) rgb(24, 25, 26)",
  );
  await page.getByRole("tab", { name: /Files \(/ }).click();
  await page.getByRole("button", { name: "Upload File" }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload a file" });
  await expect(page.locator("body")).not.toHaveClass(/theme-light/);
  await expect(uploadDialog).toHaveCSS("background-color", "rgb(29, 30, 31)");
  await expect(uploadDialog.getByRole("textbox", { name: /Display name/ })).toHaveCSS(
    "background-color",
    "rgb(20, 21, 22)",
  );
  await expect(uploadDialog.getByRole("button", { name: "Upload file" })).toHaveCSS(
    "color",
    "rgb(16, 17, 20)",
  );
  const fileDropzone = uploadDialog.getByRole("button", { name: /Choose a file or drag it here/ });
  await expect(fileDropzone).toBeFocused();
  const dropzoneBox = await fileDropzone.boundingBox();
  const uploadIconBox = await fileDropzone.locator("svg").first().locator("..").boundingBox();
  expect(dropzoneBox).not.toBeNull();
  expect(uploadIconBox).not.toBeNull();
  expect(
    Math.abs(
      (uploadIconBox!.x + uploadIconBox!.width / 2)
      - (dropzoneBox!.x + dropzoneBox!.width / 2),
    ),
  ).toBeLessThan(1);
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: imageName,
    mimeType: "image/png",
    buffer: onePixelPNG,
  });
  await uploadDialog.getByRole("textbox", { name: /Display name/ }).fill(displayName);
  await uploadDialog.getByRole("textbox", { name: /Description/ }).fill(fileDescription);
  await uploadDialog.getByRole("button", { name: "Upload file" }).click();
  await expect(uploadDialog).toHaveCount(0);
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(fileDescription, { exact: true })).toBeVisible();

  let fileCard = page.locator("[data-file-id]").filter({ hasText: displayName });
  await expect(fileCard).toHaveCSS("background-color", "rgb(30, 31, 32)");
  await expect(fileCard.locator('[data-file-icon="attachment"]')).toBeVisible();
  const darkCardNameBox = await fileCard.getByText(displayName, { exact: true }).boundingBox();
  const darkCardEditBox = await fileCard.getByRole("button", { name: "Edit" }).boundingBox();
  expect(darkCardNameBox).not.toBeNull();
  expect(darkCardEditBox).not.toBeNull();
  expect(darkCardNameBox!.x + darkCardNameBox!.width).toBeLessThan(darkCardEditBox!.x);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Switch to Light Mode" }).click();
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(page.getByRole("button", { name: "Switch to Dark Mode" })).toBeVisible();

  await page.goto("/editor");
  await expect(page.locator(".content-scroll")).toHaveCSS(
    "scrollbar-color",
    "rgb(189, 193, 198) rgb(241, 243, 244)",
  );
  await page.getByRole("tab", { name: /Files \(/ }).click();
  fileCard = page.locator("[data-file-id]").filter({ hasText: displayName });
  await expect(fileCard).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const fileEditPresentation = await fileCard.getByRole("button", { name: "Edit" }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      color: style.color,
      height: style.height,
      padding: style.padding,
    };
  });
  await fileCard.getByRole("button", { name: `Preview ${displayName}` }).click();
  let previewDialog = page.getByRole("dialog", { name: displayName });
  await expect(previewDialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const previewImage = previewDialog.getByRole("img", { name: displayName });
  await expect(previewImage.locator("..")).toHaveCSS("background-color", "rgb(246, 247, 248)");
  await expect(previewImage).toBeVisible();
  await expect.poll(async () => previewImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await previewDialog.getByRole("button", { name: "Close dialog" }).click();

  await fileCard.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit file details" });
  const displayNameInput = editDialog.getByRole("textbox", { name: /Display name/ });
  const saveDetailsButton = editDialog.getByRole("button", { name: "Save changes" });
  await expect(editDialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(displayNameInput).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(saveDetailsButton).toHaveCSS("background-color", "rgb(26, 115, 232)");
  await expect(saveDetailsButton).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(displayNameInput).toBeFocused();
  await displayNameInput.fill(updatedDisplayName);
  await editDialog.getByRole("textbox", { name: /Description/ }).fill(`Updated ${fileDescription}`);
  await page.route(/\/api\/admin\/files\/\d+$/, async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "404 page not found" });
  }, { times: 1 });
  await saveDetailsButton.click();
  await expect(editDialog.getByRole("alert")).toContainText("running backend is out of date");
  await expect(saveDetailsButton).toBeEnabled();
  await saveDetailsButton.click();
  await expect(editDialog).toHaveCount(0);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();

  fileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  const downloadHref = await fileCard.getByRole("link", { name: "Download" }).getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const imageViewURL = downloadHref!.replace(/\/download$/, "/view");

  await page.goto("/drive");
  const driveSearch = page.getByPlaceholder("Search files...");
  await submitFileSearchAndWait(page, driveSearch, imageName, driveFileSearchRoute);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toHaveCount(0);
  await submitFileSearchAndWait(page, driveSearch, `Updated ${fileDescription}`, driveFileSearchRoute);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toHaveCount(0);
  await submitFileSearchAndWait(page, driveSearch, updatedDisplayName, driveFileSearchRoute);
  const publicFileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  await expect(publicFileCard.locator('[data-file-icon="attachment"]')).toBeVisible();
  await expect(publicFileCard).not.toContainText(`Updated ${fileDescription}`);
  const publicNameBox = await publicFileCard.getByText(updatedDisplayName, { exact: true }).boundingBox();
  const publicMetaBox = await publicFileCard.locator("span").filter({ hasText: /image\/png/ }).last().boundingBox();
  expect(publicNameBox).not.toBeNull();
  expect(publicMetaBox).not.toBeNull();
  expect(publicMetaBox!.y).toBeGreaterThan(publicNameBox!.y + publicNameBox!.height);
  await page.getByRole("button", { name: `Preview ${updatedDisplayName}` }).click();
  previewDialog = page.getByRole("dialog", { name: updatedDisplayName });
  await expect(previewDialog.locator("dd").filter({ hasText: `Updated ${fileDescription}` })).toBeVisible();
  await expect(previewDialog.getByRole("img", { name: updatedDisplayName })).toBeVisible();
  await previewDialog.getByRole("button", { name: "Close dialog" }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(updatedDisplayName);
  await page.goto("/");
  await page.goBack();
  await expect(page).toHaveURL(/\/drive\?q=/);
  await expect(page.getByPlaceholder("Search files...")).toHaveValue(updatedDisplayName);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();

  await page.goto("/");
  await page.locator("#home-search-bar").fill(updatedDisplayName);
  await page.locator("#home-search-bar").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  const advancedSearchFileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  await expect(advancedSearchFileCard).toBeVisible();
  await expect(advancedSearchFileCard).not.toContainText(`Updated ${fileDescription}`);
  await advancedSearchFileCard.getByRole("button", { name: `Preview ${updatedDisplayName}` }).click();
  previewDialog = page.getByRole("dialog", { name: updatedDisplayName });
  await expect(previewDialog.locator("dd").filter({ hasText: `Updated ${fileDescription}` })).toBeVisible();
  await previewDialog.getByRole("button", { name: "Close dialog" }).click();

  const advancedSearchInput = page.locator("#search-input");
  await advancedSearchInput.fill(imageName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Files (0 results)", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(imageName);
  await advancedSearchInput.fill(`Updated ${fileDescription}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Files (0 results)", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(`Updated ${fileDescription}`);

  const initialEditorListsPromise = waitForEditorLists(page);
  await page.goto("/editor");
  await initialEditorListsPromise;
  const postsTab = page.getByRole("tab", { name: /Posts \(\d+\)/ });
  const filesTab = page.getByRole("tab", { name: /Files \(\d+\)/ });
  await expect(postsTab).not.toContainText("…");
  await expect(filesTab).not.toContainText("…");
  const defaultPostCount = await postsTab.textContent();
  const defaultFileCount = await filesTab.textContent();
  const repeatedListRequests: string[] = [];
  const trackRepeatedListRequests = (request: Request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && ["/api/admin/categories", "/api/admin/posts", "/api/admin/files"].includes(pathname)) {
      repeatedListRequests.push(pathname);
    }
  };
  page.on("request", trackRepeatedListRequests);
  await filesTab.click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return { pathname: url.pathname, tab: url.searchParams.get("tab"), query: url.searchParams.get("q") };
  }).toEqual({ pathname: "/editor", tab: "files", query: null });
  expect(repeatedListRequests).toEqual([]);
  const editorFileSearch = page.getByPlaceholder("Search files...");
  await submitFileSearchAndWait(page, editorFileSearch, `Updated ${fileDescription}`, editorFileSearchRoute);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();
  await submitFileSearchAndWait(page, editorFileSearch, imageName, editorFileSearchRoute);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toHaveCount(0);
  await submitFileSearchAndWait(page, editorFileSearch, updatedDisplayName, editorFileSearchRoute);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();

  fileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  await fileCard.getByRole("button", { name: "Edit" }).click();
  await editDialog.getByRole("textbox", { name: /Description/ }).fill(`Updated ${fileDescription}`);
  const filteredFileRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/search"
      && url.searchParams.get("scope") === "files"
      && url.searchParams.get("q") === updatedDisplayName;
  });
  await saveDetailsButton.click();
  expect((await filteredFileRefreshPromise).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/editor\?tab=files&q=/);
  await expect(editorFileSearch).toHaveValue(updatedDisplayName);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();

  const defaultFileRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/admin/files";
  });
  await postsTab.click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return { pathname: url.pathname, tab: url.searchParams.get("tab"), query: url.searchParams.get("q") };
  }).toEqual({ pathname: "/editor", tab: "posts", query: null });
  await expect(postsTab).toHaveText(defaultPostCount || "");
  await expect(filesTab).toHaveText(defaultFileCount || "");
  await expect(postsTab).not.toContainText("…");
  await expect(filesTab).not.toContainText("…");
  expect((await defaultFileRefreshPromise).ok()).toBeTruthy();
  expect(repeatedListRequests).toEqual(["/api/admin/files"]);
  page.off("request", trackRepeatedListRequests);
  await expect(page.getByPlaceholder("Search posts...")).toHaveValue("");
  await page.getByRole("button", { name: "+ New Post" }).click();
  await page.getByLabel("POST TITLE").fill(postTitle);
  await page.getByLabel("INTRODUCTION").fill("Image lifecycle verification");
  await page.locator(".custom-editor-wrapper textarea").fill(`![${imageAlt}](${imageViewURL})`);
  await selectPublicationStatus(page, "Published");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();

  await page.goto("/posts");
  await page.getByText(postTitle, { exact: true }).click();
  const publicImage = page.getByAltText(imageAlt);
  await expect(publicImage).toBeVisible();
  await expect.poll(async () => publicImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  await page.goto("/");
  await page.locator("#home-search-bar").fill(updatedDisplayName);
  await page.locator("#home-search-bar").press("Enter");
  await expect(page.locator("#search-input")).toHaveValue(updatedDisplayName);
  await page.locator("#search-input").fill(postTitle);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(postTitle);
  await page.getByText(postTitle, { exact: true }).click();
  await page.getByRole("button", { name: "←", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.locator("#search-input")).toHaveValue(postTitle);
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

  await page.goto("/posts");
  const postSearch = page.getByPlaceholder("Search posts...");
  await postSearch.fill(postTitle);
  await postSearch.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(postTitle);
  await page.getByText(postTitle, { exact: true }).click();
  await page.getByRole("button", { name: "←", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\?q=/);
  await expect(page.getByPlaceholder("Search posts...")).toHaveValue(postTitle);
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

  await page.goto("/editor");
  const editorPostSearch = page.getByPlaceholder("Search posts...");
  await editorPostSearch.fill(postTitle);
  await editorPostSearch.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(postTitle);
  const searchedPostCard = page.locator(".editor-post-card").filter({ hasText: postTitle });
  await searchedPostCard.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("INTRODUCTION").fill("Image lifecycle verification after filtered refresh");
  const filteredPostRefreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/search"
      && url.searchParams.get("scope") === "posts"
      && url.searchParams.get("q") === postTitle;
  });
  await page.getByRole("button", { name: "Save Changes" }).click();
  expect((await filteredPostRefreshPromise).ok()).toBeTruthy();
  await expect(page.getByPlaceholder("Search posts...")).toBeVisible();
  await expect(page).toHaveURL(/\/editor\?tab=posts&q=/);
  await expect(page.getByPlaceholder("Search posts...")).toHaveValue(postTitle);
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();
  await clickAtVisibleCenter(page, searchedPostCard.locator(".editor-post-category"));
  await expect(page).toHaveURL(/\/posts\/\d+$/);
  await page.getByRole("button", { name: "←", exact: true }).click();
  await expect(page).toHaveURL(/\/editor\?tab=posts&q=/);
  await expect(page.getByPlaceholder("Search posts...")).toHaveValue(postTitle);
  await expect(page.getByText(postTitle, { exact: true })).toBeVisible();

  await page.goto("/editor");
  await page.getByRole("tab", { name: /Files \(/ }).click();
  fileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  await expect(fileCard).toBeVisible();
  await page.waitForLoadState("networkidle");
  let fileListReloads = 0;
  let protectedDeleteRequests = 0;
  page.on("request", (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (request.method() === "GET" && requestPath === "/api/admin/files") {
      fileListReloads += 1;
    }
    if (request.method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(requestPath)) {
      protectedDeleteRequests += 1;
    }
  });
  await page.route(/\/api\/admin\/files\/\d+$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "storage_error", error: "Temporary storage failure" }),
    });
  }, { times: 1 });
  await fileCard.getByRole("button", { name: "Delete" }).click();
  let deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  let deletionPanel = page.getByRole("heading", { name: "Confirm Deletion" }).locator("..");
  await deletionPanel.getByRole("button", { name: "Delete", exact: true }).click();
  let deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(503);
  await expect(deletionPanel.getByRole("alert")).toContainText("Temporary storage failure");
  const retryDeleteButton = deletionPanel.getByRole("button").last();
  await expect(retryDeleteButton).toBeEnabled();
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(1);

  deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  await retryDeleteButton.click();
  deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(409);
  expect(await deleteResponse.json()).toMatchObject({ code: "file_in_use" });
  await expect(deletionPanel.getByRole("alert")).toContainText("referenced by article content or settings");
  await expect(page.getByText(updatedDisplayName, { exact: true })).toBeVisible();
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(2);

  const stablePanelHeight = (await deletionPanel.boundingBox())!.height;
  await expect(retryDeleteButton).toBeDisabled();
  await retryDeleteButton.evaluate((button: HTMLButtonElement) => button.click());
  await expect(retryDeleteButton).toHaveText("Delete");
  await expect(deletionPanel.getByRole("alert")).toContainText("referenced by article content or settings");
  expect((await deletionPanel.boundingBox())!.height).toBeCloseTo(stablePanelHeight, 1);
  expect(fileListReloads).toBe(0);
  expect(protectedDeleteRequests).toBe(2);
  await deletionPanel.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: /Posts \(/ }).click();
  const postCard = page.locator(".ai-card").filter({ hasText: postTitle });
  const postEditButton = postCard.getByRole("button", { name: "Edit" });
  await expect(postEditButton.locator("svg")).toHaveCount(1);
  expect(await postEditButton.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      color: style.color,
      height: style.height,
      padding: style.padding,
    };
  })).toEqual(fileEditPresentation);
  await postEditButton.click();
  await page.locator(".custom-editor-wrapper textarea").fill("# Image reference removed");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("✅ Saved successfully!", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Files \(/ })).toBeVisible();

  await page.getByRole("tab", { name: /Files \(/ }).click();
  fileCard = page.locator("[data-file-id]").filter({ hasText: updatedDisplayName });
  await fileCard.getByRole("button", { name: "Delete" }).click();
  deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && /\/api\/admin\/files\/\d+$/.test(response.url()),
  );
  deletionPanel = page.getByRole("heading", { name: "Confirm Deletion" }).locator("..");
  await deletionPanel.getByRole("button", { name: "Delete", exact: true }).click();
  deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  await expect(page.getByText(updatedDisplayName, { exact: true })).toHaveCount(0);
});
