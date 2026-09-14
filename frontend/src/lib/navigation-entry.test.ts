import { afterEach, expect, it, vi } from "vitest";
import { installNavigationEntries, readNavigationEntry, saveEntryScroll } from "./navigation-entry";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

it("gives repeated visits to one URL distinct entries and retains framework and guard fields", () => {
  history.replaceState({ __NA: true, tree: { route: "editor" }, blogStudioHistoryIndex: 4 }, "", "/editor?post_page=7");
  dispose = installNavigationEntries();
  const first = readNavigationEntry()!;
  saveEntryScroll(420);
  expect(readNavigationEntry()?.scroll).toBe(420);
  history.pushState({ __NA: true, tree: { route: "editor" }, blogStudioHistoryIndex: 5 }, "", "/editor?post_page=7");
  expect(readNavigationEntry()).toMatchObject({ url: first.url, scroll: 0 });
  expect(readNavigationEntry()?.id).not.toBe(first.id);
  history.replaceState(null, "", "/editor?tab=posts&post_page=7");
  expect(history.state).toMatchObject({ __NA: true, tree: { route: "editor" }, blogStudioHistoryIndex: 5 });
});

it("retains the source and its recorded scroll when the router commits after replacing the DOM", () => {
  history.replaceState({ blogSidebarSelection: "/editor" }, "", "/editor?post_page=50");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const originalPush = history.pushState;
  let sourceScroll: number | undefined;
  vi.spyOn(history, "pushState").mockImplementation(function(state, unused, url) {
    sourceScroll = readNavigationEntry()?.scroll;
    originalPush.call(history, state, unused, url);
  });
  dispose = installNavigationEntries();
  document.body.innerHTML = '<div class="content-scroll"></div>';
  saveEntryScroll(321);
  document.querySelector(".content-scroll")!.scrollTop = 0;
  history.pushState({ framework: "retained" }, "", "/posts/12");
  expect(sourceScroll).toBe(321);
  expect(readNavigationEntry()).toMatchObject({ url: "/posts/12", returnTo: "/editor?post_page=50", scroll: 0 });
  expect(history.state).toMatchObject({ blogSidebarSelection: "/editor", framework: "retained" });
});

it("rejects malformed entry metadata and keeps offset through normalized query replacement", () => {
  expect(readNavigationEntry({ blogNavigation: { version: 1, id: "x", url: "//outside.test", scroll: 2 } })).toBeUndefined();
  history.replaceState({}, "", "/editor?q=two%20words&post_page=100");
  dispose = installNavigationEntries();
  saveEntryScroll(234);
  const id = readNavigationEntry()?.id;
  history.replaceState(null, "", "/editor?q=two+words&post_page=100&tab=posts");
  expect(readNavigationEntry()).toMatchObject({ id, scroll: 234 });
});
