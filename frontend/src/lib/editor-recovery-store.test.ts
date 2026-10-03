import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_DATABASE, RECOVERY_MAX_BYTES, RECOVERY_MAX_COPIES_PER_TARGET, RECOVERY_TTL, RecoveryWriter, recoveryStorage, validRecovery, openRecoveryChannel, type RecoveryCopy, type RecoveryStorage } from "./editor-recovery-store";

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
    expect(await recoveryStorage.list(1, "post:7")).toEqual([{ ...second, createdAt: second.updatedAt }]);
  });
  it("rejects corrupt formats, wrong baselines, expired and oversized records", async () => {
    for (const row of [copy({ format: 2 as 1 }), copy({ expiresAt: 0 }), copy({ version: null }), copy({ fields: null as never }), copy({ target: "other" }), copy({ updatedAt: Date.now() + 10000 })]) expect(validRecovery(row)).toBe(false);
    const session = await recoveryStorage.start(1);
    await expect(recoveryStorage.put(session, copy({ fields: { ...fields, content: "x".repeat(RECOVERY_MAX_BYTES) } }))).rejects.toThrow();
    const row = copy(); await recoveryStorage.put(session, row);
    expect(await persistedCopy(row.id)).toEqual({ ...row, createdAt: row.updatedAt });
    vi.spyOn(Date, "now").mockReturnValue(row.expiresAt);
    expect(await recoveryStorage.list(1, row.target)).toEqual([]);
    expect(await persistedCopy(row.id)).toBeUndefined();
  });
  it("keeps three copies per article or draft and evicts the oldest entry within that target", async () => {
    const session = await recoveryStorage.start(1);
    const now = Date.now();
    const first = copy({ id: "first", updatedAt: now - 4000, expiresAt: now - 4000 + RECOVERY_TTL });
    const second = copy({ id: "second", updatedAt: now - 3000, expiresAt: now - 3000 + RECOVERY_TTL });
    const third = copy({ id: "third", updatedAt: now - 2000, expiresAt: now - 2000 + RECOVERY_TTL });
    for (const row of [first, second, third]) await expect(recoveryStorage.put(session, row)).resolves.toBeUndefined();
    await expect(recoveryStorage.put(session, { ...first, updatedAt: now - 1000, expiresAt: now - 1000 + RECOVERY_TTL })).resolves.toBeUndefined();
    expect((await persistedCopy(first.id) as RecoveryCopy).createdAt).toBe(now - 4000);
    const fourth = copy({ id: "fourth", updatedAt: now, expiresAt: now + RECOVERY_TTL });
    await expect(recoveryStorage.put(session, fourth)).resolves.toBeUndefined();
    expect(await persistedCopy(first.id)).toBeUndefined();
    expect((await recoveryStorage.list(1, "post:7")).map(row => row.id).sort()).toEqual([second.id, third.id, fourth.id].sort());
    expect(await recoveryStorage.list(1, "post:7")).toHaveLength(RECOVERY_MAX_COPIES_PER_TARGET);
    await expect(recoveryStorage.put(session, { ...first, updatedAt: now - 1000, expiresAt: now - 1000 + RECOVERY_TTL })).rejects.toThrow();
    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    await expect(recoveryStorage.put(session, { ...first, updatedAt: now + 1000, expiresAt: now + 1000 + RECOVERY_TTL })).resolves.toBeUndefined();
    expect((await recoveryStorage.list(1, "post:7")).map(row => row.id).sort()).toEqual([first.id, third.id, fourth.id].sort());
  });
  it("reserves three positions for each target without evicting another article or draft", async () => {
    const session = await recoveryStorage.start(1);
    for (const target of ["post:7", "post:8", "new:abc", "new:def"]) {
      for (let index = 0; index < RECOVERY_MAX_COPIES_PER_TARGET; index++) {
        await recoveryStorage.put(session, copy({ target, version: target.startsWith("new:") ? null : 2 }));
      }
    }
    for (const target of ["post:7", "post:8", "new:abc", "new:def"]) {
      expect(await recoveryStorage.list(1, target)).toHaveLength(RECOVERY_MAX_COPIES_PER_TARGET);
    }
    expect(await recoveryStorage.list(1, "new:*")).toHaveLength(2 * RECOVERY_MAX_COPIES_PER_TARGET);
    await recoveryStorage.put(session, copy());
    expect(await recoveryStorage.list(1, "post:8")).toHaveLength(RECOVERY_MAX_COPIES_PER_TARGET);
    expect(await recoveryStorage.list(1, "post:7")).toHaveLength(RECOVERY_MAX_COPIES_PER_TARGET);
  });
  it("reuses an unchanged restored source atomically and writes when it changes or disappears", async () => {
    const session = await recoveryStorage.start(1);
    const source = copy({ id: "source" });
    await recoveryStorage.put(session, source);
    const fork = copy({ id: "fork" });
    await recoveryStorage.put(session, fork, source.id);
    expect(await recoveryStorage.list(1, source.target)).toHaveLength(1);
    await recoveryStorage.put(session, { ...fork, version: 3 }, source.id);
    expect((await recoveryStorage.list(1, source.target)).map(row => row.id).sort()).toEqual(["fork", "source"]);
    await recoveryStorage.remove([source.id]);
    const later = copy({ id: "later", fields: source.fields });
    await recoveryStorage.put(session, later, source.id);
    expect((await recoveryStorage.list(1, source.target)).map(row => row.id).sort()).toEqual(["fork", "later"]);
  });
  it("does not merge independent copies without an explicit restored source", async () => {
    const session = await recoveryStorage.start(1);
    const first = copy({ id: "first" }), second = copy({ id: "second" });
    await recoveryStorage.put(session, first);
    await recoveryStorage.put(session, second);
    expect(await recoveryStorage.list(1, first.target)).toHaveLength(2);
  });
  it("trims older copies saved by the previous format on discovery", async () => {
    await recoveryStorage.start(1);
    const now = Date.now();
    const rows = Array.from({ length: 5 }, (_, index) => copy({
      id: `legacy-${index}`,
      updatedAt: now - (5 - index) * 1000,
      expiresAt: now - (5 - index) * 1000 + RECOVERY_TTL,
    }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(RECOVERY_DATABASE, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("copies", "readwrite");
        for (const row of rows) tx.objectStore("copies").put(row);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    expect((await recoveryStorage.list(1, "post:7")).map(row => row.id).sort()).toEqual(["legacy-2", "legacy-3", "legacy-4"]);
    expect(await persistedCopy("legacy-0")).toBeUndefined();
    expect(await persistedCopy("legacy-1")).toBeUndefined();
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
