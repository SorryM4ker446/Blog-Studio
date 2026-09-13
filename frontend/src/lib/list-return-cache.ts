import { clearListLayouts } from "./list-layout-cache";

const snapshots = new Map<string, { value: unknown; expires: number }>();
let generation = 0;

export function listCacheGeneration() { return generation; }

export function clearListReturnCache() {
  clearListLayouts();
  generation += 1;
  snapshots.clear();
}

export function readListReturnCache<T>(key: string): T | undefined {
  const entry = snapshots.get(key);
  if (!entry || entry.expires <= Date.now()) {
    snapshots.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function writeListReturnCache(key: string, value: unknown, expectedGeneration: number) {
  if (typeof window === "undefined" || generation !== expectedGeneration) return;
  snapshots.delete(key);
  snapshots.set(key, { value, expires: Date.now() + 5 * 60_000 });
  while (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
}
