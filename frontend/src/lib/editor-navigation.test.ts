import { afterEach, describe, expect, it, vi } from "vitest";
import { answerNavigationPrompt, getNavigationPrompt, installEditorNavigation, preserveExpiredEditor, registerLeaveGuard, releaseEditorNavigation, requestEditorNavigation } from "./editor-navigation";

afterEach(() => releaseEditorNavigation());
function protect(dirty = true, busy = false) {
  const flush = vi.fn().mockResolvedValue(undefined), expire = vi.fn().mockResolvedValue(undefined);
  registerLeaveGuard({ dirty: () => dirty, busy: () => busy, flush, expire });
  return { flush, expire };
}
describe("Editor leave protection", () => {
  it("cancels program navigation and flushes only after explicit continuation", async () => {
    const { flush } = protect();
    const proceed = vi.fn();
    expect(requestEditorNavigation("/posts", proceed)).toBe(false);
    expect(getNavigationPrompt()).toEqual({ busy: false, error: "" });
    await answerNavigationPrompt(false);
    expect(flush).not.toHaveBeenCalled(); expect(proceed).not.toHaveBeenCalled();
    requestEditorNavigation("/posts", proceed);
    await answerNavigationPrompt(true);
    expect(flush).toHaveBeenCalledOnce(); expect(proceed).toHaveBeenCalledOnce();
    expect(getNavigationPrompt()).toBeNull();
    expect(requestEditorNavigation(location.href)).toBe(true);
  });
  it("does not interrupt clean forms and locks busy forms", () => {
    const confirm = vi.spyOn(window, "confirm");
    protect(false); expect(requestEditorNavigation("/posts")).toBe(true);
    protect(false, true); expect(requestEditorNavigation("/posts")).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
  it("preserves content before releasing expired sessions", async () => {
    const { expire } = protect();
    await preserveExpiredEditor(); expect(expire).toHaveBeenCalledOnce();
    expect(requestEditorNavigation("/login")).toBe(true);
  });
  it("keeps framework history state and suppresses cancelled traversals and their reversal", async () => {
    history.replaceState({ framework: { tree: ["original"] } }, "", "/editor?edit=7");
    const stop = installEditorNavigation();
    const go = vi.spyOn(history, "go").mockImplementation(() => {});
    const consumer = vi.fn(); window.addEventListener("popstate", consumer);
    try {
      expect(history.state.framework).toEqual({ tree: ["original"] });
      history.pushState({ framework: { tree: ["next"] } }, "", "/editor?edit=8");
      expect(history.state.framework).toEqual({ tree: ["next"] });
      protect();
      window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 0 } }));
      expect(go).toHaveBeenCalledWith(1); expect(consumer).not.toHaveBeenCalled();
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      expect(consumer).not.toHaveBeenCalled();
      await answerNavigationPrompt(false);
      window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 0 } }));
      expect(consumer).not.toHaveBeenCalled();
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      await answerNavigationPrompt(true);
      expect(go).toHaveBeenLastCalledWith(-1);
      window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 0 } }));
      expect(consumer).toHaveBeenCalledOnce();
    } finally { stop(); window.removeEventListener("popstate", consumer); }
  });
  it("protects ordinary links and unload while allowing downloads and new tabs", async () => {
    const stop = installEditorNavigation(); protect();
    const link = document.createElement("a"); link.href = "/posts"; document.body.append(link);
    // Suppress jsdom's unimplemented navigation after checking the capture listener.
    const bubble = vi.fn((event: Event) => event.preventDefault()); link.addEventListener("click", bubble);
    try {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(getNavigationPrompt()).not.toBeNull(); expect(bubble).not.toHaveBeenCalled();
      await answerNavigationPrompt(true); expect(bubble).toHaveBeenCalledOnce();
      link.target = "_blank"; link.click();
      link.target = ""; link.download = "article"; link.click();
      link.removeAttribute("download"); link.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true, cancelable: true }));
      expect(getNavigationPrompt()).toBeNull();
      const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    } finally { link.remove(); stop(); }
  });
});

 it("deduplicates pending actions and invalidates a late continuation when the editor changes", async () => {
  const { flush } = protect();
  let finish!: () => void;
  flush.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const first = vi.fn(), second = vi.fn();
  requestEditorNavigation("/posts", first); requestEditorNavigation("/drive", second);
  const answer = answerNavigationPrompt(true);
  await answerNavigationPrompt(true);
  expect(flush).toHaveBeenCalledOnce();
  protect(); finish(); await answer;
  expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
  expect(getNavigationPrompt()).toBeNull();
});
it("retains the first action and reports failed recovery preparation without navigating", async () => {
  const { flush } = protect(); flush.mockRejectedValueOnce(new Error("Storage failed"));
  const first = vi.fn(), second = vi.fn();
  requestEditorNavigation("/posts", first); requestEditorNavigation("/drive", second);
  await answerNavigationPrompt(true);
  expect(getNavigationPrompt()).toMatchObject({ busy: false, error: expect.stringContaining("Could not prepare") });
  expect(first).not.toHaveBeenCalled();
  await answerNavigationPrompt(true);
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
});
it("allows cancellation while recovery is flushing and ignores its late completion", async () => {
  const { flush } = protect(); let finish!: () => void;
  flush.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const proceed = vi.fn(); requestEditorNavigation("/posts", proceed);
  const answer = answerNavigationPrompt(true);
  expect(getNavigationPrompt()?.busy).toBe(true);
  await answerNavigationPrompt(false);
  expect(getNavigationPrompt()).toBeNull();
  finish(); await answer;
  expect(proceed).not.toHaveBeenCalled();
});
it("dismisses pending decisions on session expiry and confirmed logout", async () => {
  protect(); const proceed = vi.fn(); requestEditorNavigation("/posts", proceed);
  await preserveExpiredEditor(); await answerNavigationPrompt(true);
  expect(proceed).not.toHaveBeenCalled(); expect(getNavigationPrompt()).toBeNull();
  protect(); requestEditorNavigation("/posts", proceed); releaseEditorNavigation();
  await answerNavigationPrompt(true); expect(proceed).not.toHaveBeenCalled();
});

it("does not replay a removed link or interrupt unrelated links and clean unloads", async () => {
  const stop = installEditorNavigation();
  protect();
  const link = document.createElement("a"); link.href = "/posts"; document.body.append(link);
  const bubble = vi.fn((event: Event) => event.preventDefault()); link.addEventListener("click", bubble);
  try {
    link.click(); link.remove(); await answerNavigationPrompt(true);
    expect(bubble).not.toHaveBeenCalled();
    document.body.append(link);
    for (const href of ["https://outside.example/", "mailto:reader@example.com", `${location.pathname}${location.search}#section`]) {
      link.href = href; link.click(); expect(getNavigationPrompt()).toBeNull();
    }
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    releaseEditorNavigation();
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  } finally { link.remove(); stop(); }
});

it("handles interrupted history reversal and no longer blocks after its guard is released", () => {
  history.replaceState(null, "", "/editor?edit=7");
  const stop = installEditorNavigation();
  const go = vi.spyOn(history, "go").mockImplementation(() => {});
  try {
    history.pushState(null, "", "/editor?edit=8");
    protect(false, true);
    window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 0 } }));
    window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: -1 } }));
    expect(go).toHaveBeenLastCalledWith(2);
    releaseEditorNavigation();
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    expect(go).toHaveBeenLastCalledWith(-1);
    window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 0 } }));
    window.dispatchEvent(new PopStateEvent("popstate", { state: { blogStudioHistoryIndex: 2 } }));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(getNavigationPrompt()).toBeNull();
  } finally { stop(); }
});

it("keeps a newer guard when expiry finishes and ignores cancelled flush errors", async () => {
  let finish!: () => void;
  const old = protect(); old.expire.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const expiry = preserveExpiredEditor(); protect(false, true); finish(); await expiry;
  expect(requestEditorNavigation("/posts")).toBe(false);
  let reject!: (error: Error) => void;
  const current = protect(); current.flush.mockReturnValue(new Promise<void>((_, fail) => { reject = fail; }));
  requestEditorNavigation("/posts");
  const answer = answerNavigationPrompt(true);
  await answerNavigationPrompt(false); reject(new Error("Late flush error")); await answer;
  expect(getNavigationPrompt()).toBeNull();
});

it("does not continue when saving starts while recovery preparation is pending", async () => {
  let busy = false;
  let finish!: () => void;
  const remove = registerLeaveGuard({ dirty: () => true, busy: () => busy, flush: () => new Promise<void>(resolve => { finish = resolve; }), expire: async () => {} });
  const proceed = vi.fn(); requestEditorNavigation("/posts", proceed);
  const answer = answerNavigationPrompt(true); busy = true; finish(); await answer;
  expect(proceed).not.toHaveBeenCalled();
  protect(); remove();
  expect(requestEditorNavigation("/posts")).toBe(false);
});
