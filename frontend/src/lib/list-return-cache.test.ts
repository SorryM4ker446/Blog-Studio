import { afterEach, expect, it, vi } from "vitest";
import { clearListReturnCache, listCacheGeneration, readListReturnCache, writeListReturnCache } from "./list-return-cache";

afterEach(() => { clearListReturnCache(); vi.useRealTimers(); });

it("expires snapshots and evicts the oldest entries", () => {
  vi.useFakeTimers();
  for (let i = 0; i < 21; i++) writeListReturnCache(String(i), i, listCacheGeneration());
  expect(readListReturnCache("0")).toBeUndefined();
  expect(readListReturnCache("20")).toBe(20);
  vi.advanceTimersByTime(5 * 60_000);
  expect(readListReturnCache("20")).toBeUndefined();
});

it("rejects late writes after logout cleanup", () => {
  const generation = listCacheGeneration();
  writeListReturnCache("page", "snapshot", generation);
  clearListReturnCache();
  writeListReturnCache("page", "late response", generation);
  expect(readListReturnCache("page")).toBeUndefined();
});
