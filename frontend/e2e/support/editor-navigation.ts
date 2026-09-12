import { expect, type Page } from "@playwright/test";

export async function answerLeaveDialog(page: Page, leave: boolean) {
  const dialog = page.getByRole("alertdialog", { name: "Leave this editor?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: leave ? "Leave editor" : "Stay in editor", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
