import { expect, type Page } from "@playwright/test";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER, E2E_API_URL } from "./test-env";

export async function loginAdmin(page: Page) {
  const csrf = await page.request.get(`${E2E_API_URL}/csrf`);
  const headers = { "X-CSRF-Token": (await csrf.json()).csrf_token };
  const login = await page.request.post(`${E2E_API_URL}/login`, {
    headers, data: { username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(login.ok()).toBeTruthy();
  return { "X-CSRF-Token": (await (await page.request.get(`${E2E_API_URL}/csrf`)).json()).csrf_token };
}

