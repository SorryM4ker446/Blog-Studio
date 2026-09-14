const key = "blogNavigation";
let revision = 0;
export const isClientNavigation = () => revision > 0;
export const navigationRevision = () => revision;
export interface NavigationEntry { version: 1; id: string; url: string; scroll: number; returnTo?: string }
const localURL = (value: unknown): value is string => typeof value === "string" && /^\/(?!\/)/.test(value) && value.length <= 4096;
export function readNavigationEntry(state: unknown = history.state): NavigationEntry | undefined {
  const entry = (state as Record<string, unknown> | null)?.[key] as NavigationEntry | undefined;
  return entry?.version === 1 && typeof entry.id === "string" && localURL(entry.url)
    && Number.isFinite(entry.scroll) && entry.scroll >= 0 && entry.scroll <= 10_000_000
    && (entry.returnTo === undefined || localURL(entry.returnTo)) ? entry : undefined;
}
export const currentLocation = () => location.pathname + location.search;

export function saveEntryScroll(position: number) {
  const entry = readNavigationEntry();
  if (!entry || entry.url !== currentLocation() || !Number.isFinite(position) || position < 0) return;
  history.replaceState({ ...history.state, [key]: { ...entry, scroll: position } }, "");
}

export function installNavigationEntries() {
  const push = history.pushState;
  const replace = history.replaceState;
  const fresh = (url: string, returnTo?: string): NavigationEntry => ({ version: 1, id: crypto.randomUUID(), url, scroll: 0, ...(returnTo ? { returnTo } : {}) });
  const initial = readNavigationEntry();
  replace.call(history, { ...history.state, [key]: initial?.url === currentLocation() ? initial : fresh(currentLocation()) }, "");
  const destination = (url?: string | URL | null) => {
    const target = new URL(url ?? location.href, location.href);
    return target.pathname + target.search;
  };
  const remember = () => {
    const entry = readNavigationEntry();
    const scroller = document.querySelector<HTMLElement>(".content-scroll");
    if (entry && scroller && entry.url === currentLocation()) {
      replace.call(history, { ...history.state, [key]: { ...entry, scroll: scroller.scrollTop } }, "");
    }
  };
  history.pushState = function(state, unused, url) {
    const target = destination(url);
    const from = currentLocation();
    const source = history.state?.blogSidebarSelection;
    push.call(this, { ...state, [key]: fresh(target, target.startsWith("/posts/") ? from : undefined),
      ...(target.startsWith("/posts/") && typeof source === "string" ? { blogSidebarSelection: source } : {}) }, unused, url);
    revision++;
  };
  history.replaceState = function(state, unused, url) {
    const target = destination(url);
    const existing = readNavigationEntry();
    const supplied = readNavigationEntry(state);
    // Framework metadata writes retain the entry; query normalization retains its offset.
    const entry = supplied?.url === target ? supplied : existing && new URL(existing.url, location.origin).pathname === new URL(target, location.origin).pathname
      ? { ...existing, url: target } : fresh(target);
    replace.call(this, { ...history.state, ...state, [key]: entry }, unused, url);
  };
  window.addEventListener("beforeunload", remember);
  window.addEventListener("pagehide", remember);
  const traversed = () => { revision++; };
  window.addEventListener("popstate", traversed);
  return () => {
    history.pushState = push; history.replaceState = replace;
    window.removeEventListener("beforeunload", remember); window.removeEventListener("pagehide", remember);
    window.removeEventListener("popstate", traversed);
    revision = 0;
  };
}
