interface LayoutSize { width: number; height: number }
const storageKey = "blogStudio:listLayouts";
const layouts = new Map<string, LayoutSize>();
let loaded = false;
let generation = 0;

function validSize(value: unknown): value is LayoutSize {
  if (!value || typeof value !== "object") return false;
  const { width, height } = value as LayoutSize;
  return Number.isFinite(width) && width > 0 && width <= 20_000
    && Number.isFinite(height) && height > 0 && height <= 100_000;
}

function loadLayouts() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
    if (stored?.version !== 1 || !Array.isArray(stored.entries)) return;
    for (const entry of stored.entries.slice(-20)) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0].length <= 2048 && validSize(entry[1])) {
        layouts.set(entry[0], { width: entry[1].width, height: entry[1].height });
      }
    }
  } catch { /* Keep layout restoration available in memory when storage is unavailable. */ }
}

export function listLayoutGeneration() { return generation; }

export function readListLayout(key: string): LayoutSize | undefined {
  loadLayouts();
  return layouts.get(key);
}

export function writeListLayout(key: string, size: LayoutSize, expectedGeneration: number) {
  if (typeof window === "undefined" || generation !== expectedGeneration || !validSize(size) || key.length > 2048) return;
  loadLayouts();
  layouts.delete(key);
  layouts.set(key, { width: size.width, height: size.height });
  while (layouts.size > 20) layouts.delete(layouts.keys().next().value!);
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, entries: [...layouts] }));
  } catch { /* The current tab can still reuse its in-memory measurements. */ }
}

export function clearListLayouts() {
  generation += 1;
  loaded = true;
  layouts.clear();
  if (typeof document !== "undefined") document.getElementById("blog-initial-view")?.remove();
  try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage can be blocked. */ }
}
