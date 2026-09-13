import { beforeEach, afterEach, expect, it, vi } from "vitest";

const storageKey = "blogStudio:listLayouts";
beforeEach(() => { window.sessionStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("restores only geometry after refresh and beyond the data snapshot lifetime", async () => {
  vi.useFakeTimers();
  const cache = await import("./list-layout-cache");
  cache.writeListLayout("editor", { width: 1200, height: 680 }, cache.listLayoutGeneration());
  vi.advanceTimersByTime(6 * 60_000);
  vi.resetModules();
  const refreshed = await import("./list-layout-cache");
  expect(refreshed.readListLayout("editor")).toEqual({ width: 1200, height: 680 });
});

it("bounds entries and rejects invalid or unsupported stored geometry", async () => {
  window.sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, entries: [["bad", { width: 1, height: 1e9 }], ["good", { width: 400, height: 600 }]] }));
  const cache = await import("./list-layout-cache");
  expect(cache.readListLayout("bad")).toBeUndefined();
  expect(cache.readListLayout("good")).toEqual({ width: 400, height: 600 });
  for (let i = 0; i < 21; i++) cache.writeListLayout(String(i), { width: 400, height: 600 }, cache.listLayoutGeneration());
  expect(cache.readListLayout("0")).toBeUndefined();
  expect(JSON.parse(window.sessionStorage.getItem(storageKey)!).entries).toHaveLength(20);
  window.sessionStorage.setItem(storageKey, '{"version":2,"entries":[]}');
  vi.resetModules();
  expect((await import("./list-layout-cache")).readListLayout("20")).toBeUndefined();
});

it("falls back to memory when storage is corrupt, blocked or full", async () => {
  window.sessionStorage.setItem(storageKey, "invalid json");
  const cache = await import("./list-layout-cache");
  expect(cache.readListLayout("editor")).toBeUndefined();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  cache.writeListLayout("editor", { width: 400, height: 600 }, cache.listLayoutGeneration());
  expect(cache.readListLayout("editor")).toEqual({ width: 400, height: 600 });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  vi.resetModules();
  expect((await import("./list-layout-cache")).readListLayout("editor")).toBeUndefined();
});

it("clears persistent geometry on logout and rejects late resize callbacks", async () => {
  const cache = await import("./list-layout-cache");
  const generation = cache.listLayoutGeneration();
  cache.writeListLayout("editor", { width: 400, height: 600 }, generation);
  const initialStyle = document.createElement("style");
  initialStyle.id = "blog-initial-view";
  document.head.appendChild(initialStyle);
  const dataCache = await import("./list-return-cache");
  dataCache.clearListReturnCache();
  cache.writeListLayout("editor", { width: 400, height: 900 }, generation);
  expect(cache.readListLayout("editor")).toBeUndefined();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(document.getElementById("blog-initial-view")).toBeNull();
});
