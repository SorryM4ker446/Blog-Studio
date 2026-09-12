export interface LeaveGuard {
  dirty: () => boolean;
  busy: () => boolean;
  flush: () => Promise<void>;
  expire: () => Promise<void>;
}
let guard: LeaveGuard | null = null;
type NavigationPrompt = { busy: boolean; error: string } | null;
let prompt: NavigationPrompt = null;
let pending: { owner: LeaveGuard; proceed: () => void } | null = null;
let continuing = false;
const listeners = new Set<() => void>();
function publishPrompt(value: NavigationPrompt) { prompt = value; listeners.forEach(listener => listener()); }
function cancelPrompt() { pending = null; publishPrompt(null); }
export const getNavigationPrompt = () => prompt;
export function subscribeNavigationPrompt(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export async function answerNavigationPrompt(leave: boolean) {
  const request = pending;
  if (!request) return;
  if (!leave) { cancelPrompt(); return; }
  if (prompt?.busy) return;
  publishPrompt({ busy: true, error: "" });
  try { await request.owner.flush(); }
  catch {
    if (pending === request) publishPrompt({ busy: false, error: "Could not prepare browser recovery. Stay here and copy your text, or try again." });
    return;
  }
  if (pending !== request) return;
  cancelPrompt();
  if (guard !== request.owner || guard.busy()) return;
  // Replay only the approved action. Later actions and asynchronous history
  // traversals must still pass their own navigation boundary.
  continuing = true;
  try { request.proceed(); } finally { continuing = false; }
}
export function registerLeaveGuard(value: LeaveGuard) {
  if (guard !== value) cancelPrompt();
  guard = value;
  return () => { if (guard === value) { guard = null; cancelPrompt(); } };
}
export function requestEditorNavigation(url?: string, proceed: () => void = () => {}): boolean {
  if (continuing) return true;
  if (url && new URL(url, window.location.href).href === window.location.href) return true;
  if (!guard) return true;
  if (guard.busy()) return false;
  if (!guard.dirty()) return true;
  if (!pending) {
    pending = { owner: guard, proceed };
    publishPrompt({ busy: false, error: "" });
  }
  return false;
}
export async function preserveExpiredEditor() {
  if (!guard) return;
  const active = guard;
  cancelPrompt();
  await active.expire();
  if (guard === active) { guard = null; cancelPrompt(); }
}
export function releaseEditorNavigation() { guard = null; cancelPrompt(); }

const indexKey = "blogStudioHistoryIndex";
export function installEditorNavigation() {
  let index = Number.isSafeInteger(history.state?.[indexKey]) ? history.state[indexKey] as number : 0;
  let restoring: { destination: number } | null = null;
  let approved: number | null = null;
  const push = history.pushState;
  const replace = history.replaceState;
  const stateWithIndex = (state: unknown, next: number) => ({ ...(state && typeof state === "object" ? state : {}), [indexKey]: next });
  replace.call(history, stateWithIndex(history.state, index), "");
  history.pushState = function(state, unused, url) { push.call(this, stateWithIndex(state, index + 1), unused, url); index++; };
  history.replaceState = function(state, unused, url) { replace.call(this, stateWithIndex(state, index), unused, url); };
  const pop = (event: PopStateEvent) => {
    const next = event.state?.[indexKey];
    if (restoring && Number.isSafeInteger(next)) {
      event.stopImmediatePropagation();
      if (next !== index) { history.go(index - next); return; }
      const { destination } = restoring;
      restoring = null;
      const proceed = () => { approved = destination; history.go(destination - index); };
      if (requestEditorNavigation(undefined, proceed)) proceed();
      return;
    }
    if (approved !== null && approved === next) { approved = null; index = next; return; }
    approved = null;
    if (Number.isSafeInteger(next) && next !== index && guard && (guard.dirty() || guard.busy())) {
      event.stopImmediatePropagation();
      // Restore the current entry before opening an asynchronous dialog. Neither
      // the router nor scroll restoration observes the tentative destination.
      restoring = { destination: next };
      history.go(index - next);
      return;
    }
    if (Number.isSafeInteger(next)) index = next;
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol) || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
    const destination = link.href;
    if (!requestEditorNavigation(destination, () => {
      if (link.isConnected && link.href === destination) link.click();
    })) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (guard && (guard.dirty() || guard.busy())) { void guard.flush(); event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("popstate", pop, true);
  document.addEventListener("click", click, true);
  window.addEventListener("beforeunload", unload);
  return () => {
    cancelPrompt();
    history.pushState = push; history.replaceState = replace;
    window.removeEventListener("popstate", pop, true);
    document.removeEventListener("click", click, true);
    window.removeEventListener("beforeunload", unload);
  };
}
