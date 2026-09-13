import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialViewScript } from "./initial-view";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/posts/12");
  // jsdom has no CSS.escape; these cases use plain attribute values.
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => {
  document.getElementById("blog-initial-view")?.remove();
  document.documentElement.removeAttribute("data-initial-sidebar");
  vi.unstubAllGlobals();
});

it("prepares the history source and width-specific geometry without changing the server markup", () => {
  window.history.replaceState({ blogSidebarSelection: "/search", routerState: "retained" }, "", "/posts/12");
  sessionStorage.setItem("blogStudio:listLayouts", JSON.stringify({ version: 1, entries: [
    ["editor", { width: 800, height: 600 }], ["invalid", { width: 800, height: -1 }],
  ] }));
  window.eval(initialViewScript);
  expect(document.documentElement.getAttribute("data-initial-sidebar")).toBe("/search");
  const style = document.getElementById("blog-initial-view")!.textContent;
  expect(style).toContain("@container list-results (min-width:799px) and (max-width:801px)");
  expect(style).toContain("min-height:600px");
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
