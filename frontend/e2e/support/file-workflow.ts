import { expect, type Locator, type Page } from "@playwright/test";

export const onePixelPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const driveFileSearchRoute = { pagePath: "/drive", apiPath: "/api/search" };
export const editorFileSearchRoute = {
  pagePath: "/editor",
  apiPath: "/api/admin/search",
  tab: "files" as const,
};

export async function submitFileSearchAndWait(
  page: Page,
  input: Locator,
  query: string,
  expected: { pagePath: string; apiPath: string; tab?: "files" },
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

export async function clickAtVisibleCenter(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

export async function readEditActionPresentation(button: Locator) {
  let presentation = {
    backgroundColor: "",
    border: "",
    borderRadius: "",
    color: "",
    height: "",
    padding: "",
  };
  await expect(button).toBeVisible();
  await expect.poll(async () => {
    presentation = await button.evaluate((element) => {
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
    return Object.values(presentation).every(Boolean);
  }).toBe(true);
  return presentation;
}

