import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import {
  E2E_API_URL,
  E2E_APP_URL,
  E2E_JWT_SECRET,
} from "./e2e/support/test-env";

const testDatabaseDsn = process.env.TEST_DB_DSN?.trim();
if (!testDatabaseDsn) {
  throw new Error("TEST_DB_DSN is required for Playwright tests");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: E2E_APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "go run ./cmd/server",
      cwd: path.resolve(__dirname, "../backend"),
      url: `${E2E_API_URL}/settings`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        DB_DSN: testDatabaseDsn,
        JWT_SECRET: E2E_JWT_SECRET,
        SERVER_ADDRESS: "127.0.0.1:18080",
        APP_ENV: "test",
        ALLOWED_ORIGINS: E2E_APP_URL,
        COOKIE_SECURE: "false",
        UPLOAD_DIR: path.resolve(__dirname, "../backend/.test-uploads"),
      },
    },
    {
      command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
      cwd: __dirname,
      url: E2E_APP_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: E2E_API_URL,
      },
    },
  ],
});
