import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_DATABASE, RECOVERY_MAX_BYTES, RECOVERY_MAX_COPIES, RECOVERY_TTL, RecoveryWriter, recoveryStorage, validRecovery, openRecoveryChannel, type RecoveryCopy, type RecoveryStorage } from "./editor-recovery-store";

const fields = { title: "Local", summary: "", content: "Unsaved body", category_id: 0 };
function persistedCopy(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECOVERY_DATABASE, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("copies", "readonly");
      const row = tx.objectStore("copies").get(id);
      tx.oncomplete = () => { db.close(); resolve(row.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
function copy(patch: Partial<RecoveryCopy> = {}): RecoveryCopy {
  const now = Date.now();
  return { id: crypto.randomUUID(), format: 1, userId: 1, target: "post:7", tab: "tab-a", updatedAt: now, expiresAt: now + RECOVERY_TTL,
    version: 2, baseline: { ...fields, content: "Saved" }, fields, ...patch };
}
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Browser recovery storage", () => {
  it("treats missing or denied cross-tab notification channels as optional", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(openRecoveryChannel()).toBeNull();
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new DOMException("Denied", "SecurityError"); } });
    expect(openRecoveryChannel()).toBeNull();
  });
  it("isolates users, articles, new drafts and independently writable copies", async () => {
    const session = await recoveryStorage.start(1);
    const first = copy(), second = copy({ tab: "tab-b" });
    for (const row of [first, second, copy({ target: "post:8" }), copy({ target: "new:abc", version: null })]) await recoveryStorage.put(session, row);
    expect(await recoveryStorage.list(1, "post:7")).toHaveLength(2);
    expect(await recoveryStorage.list(2, "post:7")).toEqual([]);
    expect(await recoveryStorage.list(1, "new:other")).toEqual([]);
    await recoveryStorage.remove([first.id]);
    await expect(recoveryStorage.put(session, first)).rejects.toThrow();
    expect(await recoveryStorage.list(1, "post:7")).toEqual([second]);
  });
  it("rejects corrupt formats, wrong baselines, expired and oversized records", async () => {
    for (const row of [copy({ format: 2 as 1 }), copy({ expiresAt: 0 }), copy({ version: null }), copy({ fields: null as never }), copy({ target: "other" }), copy({ updatedAt: Date.now() + 10000 })]) expect(validRecovery(row)).toBe(false);
    const session = await recoveryStorage.start(1);
    await expect(recoveryStorage.put(session, copy({ fields: { ...fields, content: "x".repeat(RECOVERY_MAX_BYTES) } }))).rejects.toThrow();
    const row = copy(); await recoveryStorage.put(session, row);
    expect(await persistedCopy(row.id)).toEqual(row);
    vi.spyOn(Date, "now").mockReturnValue(row.expiresAt);
    expect(await recoveryStorage.list(1, row.target)).toEqual([]);
    expect(await persistedCopy(row.id)).toBeUndefined();
  });
  it("refuses capacity overflow without evicting existing unsaved copies", async () => {
    const session = await recoveryStorage.start(1);
    for (let i = 0; i < RECOVERY_MAX_COPIES; i++) await recoveryStorage.put(session, copy());
    await expect(recoveryStorage.put(session, copy())).rejects.toThrow();
    expect(await recoveryStorage.list(1, "post:7")).toHaveLength(RECOVERY_MAX_COPIES);
  });
  it("invalidates old writers on logout, including writers in other tabs", async () => {
    const old = await recoveryStorage.start(1), other = await recoveryStorage.start(2);
    await recoveryStorage.put(old, copy());
    await recoveryStorage.put(other, copy({ userId: 2 }));
    await recoveryStorage.clearUser(1);
    await expect(recoveryStorage.put(old, copy())).rejects.toThrow();
    expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
    expect(await recoveryStorage.list(2, "post:7")).toHaveLength(1);
    await recoveryStorage.put(await recoveryStorage.start(1), copy());
    expect(await recoveryStorage.list(1, "post:7")).toHaveLength(1);
  });
  it("reports unavailable and denied storage without an uncaught exception", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new DOMException("Denied", "SecurityError"); } });
    await expect(recoveryStorage.list(1, "post:7")).rejects.toThrow();
  });
  it("removes malformed persisted rows on discovery", async () => {
    await recoveryStorage.start(1);
    await new Promise<void>(resolve => {
      const request = indexedDB.open(RECOVERY_DATABASE, 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("copies", "readwrite");
        tx.objectStore("copies").put({ id: "corrupt", userId: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    expect(await persistedCopy("corrupt")).toEqual({ id: "corrupt", userId: 1 });
    expect(await recoveryStorage.list(1, "post:7")).toEqual([]);
    expect(await persistedCopy("corrupt")).toBeUndefined();
  });
});

describe("Recovery write scheduling", () => {
  it("throttles continuous input to the latest snapshot and flushes immediately when requested", async () => {
    vi.useFakeTimers();
    const put = vi.fn().mockResolvedValue(undefined);
    const writer = new RecoveryWriter({ put } as unknown as RecoveryStorage, { userId: 1, epoch: 0, startedAt: Date.now() }, vi.fn());
    writer.schedule(copy());
    await vi.advanceTimersByTimeAsync(500);
    writer.schedule(copy({ fields: { ...fields, content: "Newest" } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1].fields.content).toBe("Newest");
    writer.schedule(copy()); await writer.flush(); expect(put).toHaveBeenCalledTimes(2);
  });
  it("orders clear after an in-flight write and cancels queued and delayed writes", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const events: string[] = [];
    const storage = { put: vi.fn(() => new Promise<void>(resolve => { finish = () => { events.push("put"); resolve(); }; })), remove: vi.fn(async () => { events.push("clear"); }) };
    const writer = new RecoveryWriter(storage as unknown as RecoveryStorage, { userId: 1, epoch: 0, startedAt: Date.now() }, vi.fn());
    writer.schedule(copy()); void writer.flush(); await Promise.resolve();
    writer.schedule(copy()); void writer.flush(); writer.schedule(copy());
    const cleared = writer.clear(["old"]); finish(); await cleared;
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toEqual(["put", "clear"]);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
  it("reports quota failures and remains usable for manual retries", async () => {
    const error = vi.fn(); const put = vi.fn().mockRejectedValue(new Error("Quota"));
    const writer = new RecoveryWriter({ put } as unknown as RecoveryStorage, { userId: 1, epoch: 0, startedAt: Date.now() }, error);
    writer.schedule(copy()); await writer.flush(); expect(error).toHaveBeenCalledOnce();
    put.mockResolvedValue(undefined); writer.schedule(copy()); await writer.flush(); expect(put).toHaveBeenCalledTimes(2);
  });
});
