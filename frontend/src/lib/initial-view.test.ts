import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialViewScript } from "./initial-view";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/posts/12");
  // jsdom has no CSS.escape; these cases use plain attribute values.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => {
  window.dispatchEvent(new Event("blog:initial-view-ready"));
  window.dispatchEvent(new Event("load"));
  document.getElementById("blog-initial-view")?.remove();
  document.documentElement.removeAttribute("data-initial-sidebar");
  document.documentElement.removeAttribute("data-initial-scroll-cancelled");
  document.documentElement.removeAttribute("data-initial-editor-loading");
  vi.unstubAllGlobals();
});

it("prepares the history source and removes obsolete geometry without changing server markup", () => {
  window.history.replaceState({ blogSidebarSelection: "/search", routerState: "retained" }, "", "/posts/12");
  sessionStorage.setItem("blogStudio:listLayouts", JSON.stringify({ version: 1, entries: [
    ["editor", { width: 800, height: 600 }], ["invalid", { width: 800, height: -1 }],
  ] }));
  window.eval(initialViewScript);
  expect(document.documentElement.getAttribute("data-initial-sidebar")).toBe("/search");
  const style = document.getElementById("blog-initial-view")!.textContent;
  expect(style).not.toContain("@container");
  expect(style).not.toContain("min-height");
  expect(sessionStorage.getItem("blogStudio:listLayouts")).toBeNull();
  expect(style).not.toContain("invalid");
  expect(window.history.state.routerState).toBe("retained");
});

it("ignores invalid history metadata and corrupt or unavailable storage", () => {
  window.history.replaceState({ blogSidebarSelection: '"}body{display:none}' }, "", "/posts/12");
  sessionStorage.setItem("blogStudio:listLayouts", "bad json");
  expect(() => window.eval(initialViewScript)).not.toThrow();
  expect(document.documentElement).not.toHaveAttribute("data-initial-sidebar");
  expect(document.getElementById("blog-initial-view")!.textContent).toBe("");
  document.getElementById("blog-initial-view")!.remove();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  expect(() => window.eval(initialViewScript)).not.toThrow();
});

it("does not use a detail's history source on another route or unsupported layout versions", () => {
  window.history.replaceState({ blogSidebarSelection: "/search" }, "", "/editor");
  sessionStorage.setItem("blogStudio:listLayouts", JSON.stringify({ version: 2, entries: [["editor", { width: 800, height: 600 }]] }));
  window.eval(initialViewScript);
  expect(document.documentElement).not.toHaveAttribute("data-initial-sidebar");
  expect(document.getElementById("blog-initial-view")!.textContent).toBe("");
});

it("restores bounded recovery labels and notice geometry for the same editor, owner and viewport", () => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  history.replaceState({ blogEditorLayout: { version: 2, url: "/editor?edit=12", owner: 7,
    width: innerWidth, height: innerHeight, recovery: 380, conflict: 0,
    copies: [{ title: "Browser title", date: "2026/10/03 12:00:00" }] } }, "", "/editor?edit=12");
  window.eval(initialViewScript);
  const style = document.getElementById("blog-initial-view")!.textContent;
  expect(style).toContain('[data-editor-owner="7"][data-recovery-checking="true"]');
  expect(style).toContain('[data-editor-notice="recovery"]{min-height:380px;}');
  expect(style).toContain('[data-recovery-shell][data-loading="true"]{display:grid;}');
  expect(style).toContain('[data-recovery-title]::before{content:"Browser title";}');
  expect(style).toContain('[data-recovery-count]::before{content:"1 copy";}');
  expect(style).toContain('[data-editor-notice="conflict"]{min-height:0px;}');
  expect(document.querySelector(".editor-detail-frame")).toBeNull();
});

it("resets all scroll regions on reload, including content added before hydration", async () => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  document.body.innerHTML = '<div class="content-scroll"><textarea></textarea></div><aside></aside>';
  document.querySelectorAll("div, textarea, aside").forEach(element => { element.scrollTop = 120; });
  window.eval(initialViewScript);
  expect(Array.from(document.querySelectorAll("div, textarea, aside")).every(element => element.scrollTop === 0)).toBe(true);
  const preview = document.createElement("div");
  preview.scrollTop = 250;
  document.body.append(preview);
  await Promise.resolve();
  expect(preview.scrollTop).toBe(0);
  window.dispatchEvent(new Event("blog:initial-view-ready"));
  window.dispatchEvent(new Event("load"));
  preview.scrollTop = 80;
  document.body.append(document.createElement("span"));
  await Promise.resolve();
  expect(preview.scrollTop).toBe(80);
  document.body.innerHTML = "";
});

it("stops reload resets when the user scrolls before hydration", async () => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  document.body.innerHTML = '<div class="content-scroll"></div>';
  window.eval(initialViewScript);
  window.dispatchEvent(new Event("wheel"));
  const scroll = document.querySelector("div")!;
  scroll.scrollTop = 100;
  scroll.append(document.createElement("p"));
  await Promise.resolve();
  expect(scroll.scrollTop).toBe(100);
  expect(document.documentElement).toHaveAttribute("data-initial-scroll-cancelled", "true");
  document.body.innerHTML = "";
});

it.each([
  { url: "/editor?edit=13" }, { version: 1 }, { owner: -1 }, { width: 0 },
  { recovery: -1 }, { conflict: 10_001 }, { recovery: '0px;}body{display:none' },
  { copies: null }, { copies: [{ title: 123, date: "date" }] },
  { copies: [{ title: "x".repeat(256), date: "date" }] },
  { copies: Array.from({ length: 4 }, () => ({ title: "Title", date: "date" })) },
])("ignores stale or unsafe editor notice metadata: %j", invalid => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  history.replaceState({ blogEditorLayout: { version: 2, url: "/editor?edit=12", owner: 7,
    width: innerWidth, height: innerHeight, recovery: 380, conflict: 0, copies: [], ...invalid } }, "", "/editor?edit=12");
  window.eval(initialViewScript);
  expect(document.getElementById("blog-initial-view")!.textContent).toBe("");
});

it("keeps the previous conflict height without fabricating recovery rows", () => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  history.replaceState({ blogEditorLayout: { version: 2, url: "/editor?edit=12", owner: 7,
    width: innerWidth, height: innerHeight, recovery: 0, conflict: 620, copies: [] } }, "", "/editor?edit=12");
  window.eval(initialViewScript);
  const style = document.getElementById("blog-initial-view")!.textContent;
  expect(style).toContain('[data-editor-notice="conflict"]{min-height:620px;}');
  expect(style).not.toContain("data-recovery-title");
  expect(style).not.toContain("display:grid");
});

it.each([1, 2, 3])("renders all %i retained copy labels and escapes them as CSS text", count => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  const escape = vi.fn((value: string) => `escaped-${value.length}`);
  vi.stubGlobal("CSS", { escape });
  const copies = Array.from({ length: count }, (_, index) => ({ title: `Copy ${index} \"<&>`, date: `Date ${index}` }));
  history.replaceState({ blogEditorLayout: { version: 2, url: "/editor?edit=12", owner: 7,
    width: innerWidth, height: innerHeight, recovery: 380, conflict: 0, copies } }, "", "/editor?edit=12");
  window.eval(initialViewScript);
  const style = document.getElementById("blog-initial-view")!.textContent;
  copies.forEach((copy, index) => {
    expect(escape).toHaveBeenCalledWith(copy.title);
    expect(escape).toHaveBeenCalledWith(copy.date);
    expect(style).toContain(`[data-recovery-copy="${index}"]{display:flex;}`);
  });
  expect(style).not.toContain('"<&>');
});
