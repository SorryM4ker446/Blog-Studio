import type { PostSnapshot } from "./post-editor";

export const RECOVERY_TTL = 7 * 24 * 60 * 60_000;
export const RECOVERY_MAX_BYTES = 4 * 1024 * 1024;
export const RECOVERY_MAX_COPIES = 20;
export const RECOVERY_DATABASE = "blog-studio-editor-recovery";
export interface RecoveryCopy {
  id: string;
  format: 1;
  userId: number;
  target: string;
  tab: string;
  updatedAt: number;
  expiresAt: number;
  version: number | null;
  baseline: PostSnapshot;
  fields: PostSnapshot;
}
export interface RecoverySession { userId: number; epoch: number; startedAt: number }
export interface RecoveryStorage {
  start(userId: number): Promise<RecoverySession>;
  list(userId: number, target: string, onInvalid?: () => void): Promise<RecoveryCopy[]>;
  put(session: RecoverySession, copy: RecoveryCopy): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clearUser(userId: number): Promise<void>;
}

export function openRecoveryChannel(): BroadcastChannel | null {
  try { return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("blogStudio:recovery") : null; }
  catch { return null; }
}

function snapshot(value: unknown): value is PostSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as PostSnapshot;
  return typeof v.title === "string" && v.title.length <= 255 && typeof v.summary === "string" && v.summary.length <= 1000
    && typeof v.content === "string" && Number.isSafeInteger(v.category_id) && v.category_id >= 0;
}
export function validRecovery(value: unknown, now = Date.now()): value is RecoveryCopy {
  if (!value || typeof value !== "object") return false;
  const v = value as RecoveryCopy;
  return v.format === 1 && typeof v.id === "string" && typeof v.tab === "string" && Number.isSafeInteger(v.userId) && v.userId > 0
    && typeof v.target === "string" && /^(post:[1-9]\d*|new:[a-zA-Z0-9-]+)$/.test(v.target)
    && Number.isFinite(v.updatedAt) && v.updatedAt <= now && v.expiresAt > now && v.expiresAt <= v.updatedAt + RECOVERY_TTL
    && (v.target.startsWith("new:") ? v.version === null : Number.isSafeInteger(v.version) && Number(v.version) > 0)
    && snapshot(v.baseline) && snapshot(v.fields);
}
export function recoveryBytes(copy: RecoveryCopy) { return new TextEncoder().encode(JSON.stringify(copy)).length; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => { settled = true; reject(new Error("Recovery storage timed out")); }, 3000);
    const failed = () => { settled = true; clearTimeout(timeout); reject(new Error("Recovery storage unavailable")); };
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(RECOVERY_DATABASE, 1); } catch { failed(); return; }
    request.onupgradeneeded = () => {
      request.result.createObjectStore("copies", { keyPath: "id" });
      request.result.createObjectStore("meta");
    };
    request.onerror = request.onblocked = failed;
    request.onsuccess = () => { clearTimeout(timeout); if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
  });
}
async function transaction<T>(work: (copies: IDBObjectStore, meta: IDBObjectStore, done: (result: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(["copies", "meta"], "readwrite");
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Recovery storage unavailable or full")); };
    try { work(tx.objectStore("copies"), tx.objectStore("meta"), value => { result = value; }); }
    catch { tx.abort(); }
  });
}

export const recoveryStorage: RecoveryStorage = {
  start: userId => transaction((_copies, meta, done) => {
    const obsolete = meta.openCursor();
    obsolete.onsuccess = () => {
      const cursor = obsolete.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith("removed:") && cursor.value <= Date.now() - RECOVERY_TTL) cursor.delete();
      cursor.continue();
    };
    const request = meta.get(`user:${userId}`);
    request.onsuccess = () => done({ userId, epoch: request.result ?? 0, startedAt: Date.now() });
  }),
  list: (userId, target, onInvalid) => transaction((copies, _meta, done) => {
    const request = copies.getAll();
    request.onsuccess = () => {
      const valid: RecoveryCopy[] = [];
      for (const copy of request.result) {
        if (!validRecovery(copy)) { copies.delete(copy.id); if (copy.userId === userId) onInvalid?.(); }
        else if (copy.userId === userId && (copy.target === target || (target === "new:*" && copy.target.startsWith("new:")))) valid.push(copy);
      }
      done(valid.sort((a, b) => b.updatedAt - a.updatedAt));
    };
  }),
  put: (session, copy) => transaction((copies, meta, done) => {
    if (!validRecovery(copy) || copy.userId !== session.userId || recoveryBytes(copy) > RECOVERY_MAX_BYTES) throw new Error("Invalid recovery copy");
    const epoch = meta.get(`user:${session.userId}`);
    epoch.onsuccess = () => {
      if ((epoch.result ?? 0) !== session.epoch || Date.now() - session.startedAt >= RECOVERY_TTL) { copies.transaction.abort(); return; }
      const removed = meta.get(`removed:${copy.id}`);
      removed.onsuccess = () => {
        if (removed.result) { copies.transaction.abort(); return; }
        const all = copies.getAll();
        all.onsuccess = () => {
          const remaining: RecoveryCopy[] = [];
          for (const row of all.result) {
            if (!validRecovery(row)) copies.delete(row.id);
            else if (row.id !== copy.id) remaining.push(row);
          }
          // Refuse a write rather than evict another tab's unsaved work.
          if (remaining.length >= RECOVERY_MAX_COPIES || remaining.reduce((n, row) => n + recoveryBytes(row), recoveryBytes(copy)) > RECOVERY_MAX_BYTES) {
            copies.transaction.abort(); return;
          }
          copies.put(copy);
          done();
        };
      };
    };
  }),
  remove: ids => transaction((copies, meta, done) => {
    for (const id of ids) { copies.delete(id); meta.put(Date.now(), `removed:${id}`); }
    done();
  }),
  clearUser: userId => transaction((copies, meta, done) => {
    const epoch = meta.get(`user:${userId}`);
    epoch.onsuccess = () => meta.put((epoch.result ?? 0) + 1, `user:${userId}`);
    const all = copies.getAll();
    all.onsuccess = () => { for (const copy of all.result) if (copy.userId === userId) copies.delete(copy.id); done(); };
  }),
};

export class RecoveryWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: RecoveryCopy | undefined;
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  constructor(private storage: RecoveryStorage, private session: RecoverySession, private onError: () => void) {}
  schedule(copy: RecoveryCopy) {
    this.pending = structuredClone(copy);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 1000);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const copy = this.pending;
    this.pending = undefined;
    const generation = this.generation;
    if (copy) this.chain = this.chain.then(async () => {
      if (generation === this.generation) await this.storage.put(this.session, copy);
    }).catch(this.onError);
    return this.chain;
  }
  cancel() { this.generation++; this.pending = undefined; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  clear(ids: string[]) {
    this.cancel();
    const result = this.chain.then(() => this.storage.remove(ids)).then(() => true, () => { this.onError(); return false; });
    this.chain = result.then(() => {});
    return result;
  }
}
