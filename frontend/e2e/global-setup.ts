import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ADMIN_PASS, E2E_ADMIN_USER } from "./support/test-env";

export default function globalSetup() {
  const testDatabaseDsn = process.env.TEST_DB_DSN?.trim();
  if (!testDatabaseDsn) {
    throw new Error("TEST_DB_DSN is required for Playwright tests");
  }

  execFileSync("go", ["run", "./cmd/testsetup"], {
    cwd: path.resolve(__dirname, "../../backend"),
    env: {
      ...process.env,
      TEST_DB_DSN: testDatabaseDsn,
      E2E_ADMIN_USER,
      E2E_ADMIN_PASS,
    },
    stdio: "inherit",
  });
}
