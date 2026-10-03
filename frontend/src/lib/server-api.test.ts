import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("deduplicates real server renders while isolating cookies, timeouts and subsequent renders", () => {
  const runner = resolve("src/test/server-reads.mjs");
  const source = resolve("src/lib/server-api.ts");
  const result = execFileSync(process.execPath, ["--conditions=react-server", "--experimental-strip-types", runner, source], {
    encoding: "utf8", timeout: 15_000,
  });
  expect(result.trim()).toBe("Server read contracts passed");
});
