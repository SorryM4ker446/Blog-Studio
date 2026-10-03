import { afterEach, expect, it, vi } from "vitest";
import { restoreScroll, scrollPageToTop } from "./restore-scroll";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it.each(["wheel", "touchstart", "pointerdown", "keydown"])("cancels delayed restoration on %s without taking scroll back", event => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  document.body.appendChild(container);
  let height = 0, position = 0;
  Object.defineProperty(container, "scrollTop", { get: () => position, set: value => { position = Math.min(value, height); } });
  const done = vi.fn();
  const dispose = restoreScroll(container, 500, done);
  if (event === "keydown") window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
  else container.dispatchEvent(new Event(event));
  height = 1000; position = 120;
  vi.advanceTimersByTime(3000);
  expect(position).toBe(120);
  expect(done).toHaveBeenCalledTimes(1);
  dispose();
  expect(done).toHaveBeenCalledTimes(1);
});

it("bounds restoration and cleans up when delayed content never arrives", () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  Object.defineProperty(container, "scrollTop", { get: () => 0, set: () => {} });
  const done = vi.fn();
  restoreScroll(container, 500, done);
  vi.advanceTimersByTime(2100);
  expect(done).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for recovery discovery beyond the layout retry window, then restores the final height", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  container.innerHTML = '<div data-scroll-pending="true"></div>';
  let height = 100, position = 0;
  Object.defineProperty(container, "scrollTop", { get: () => position, set: value => { position = Math.min(value, height); } });
  const done = vi.fn();
  restoreScroll(container, 500, done);
  vi.advanceTimersByTime(3000);
  expect(done).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  height = 1000;
  container.firstElementChild!.setAttribute("data-scroll-pending", "false");
  await Promise.resolve();
  expect(position).toBe(500);
  expect(done).toHaveBeenCalledTimes(1);
});

it("cancels pending recovery restoration when the user starts scrolling", async () => {
  const container = document.createElement("div");
  container.innerHTML = '<div data-scroll-pending="true"></div>';
  const done = vi.fn();
  restoreScroll(container, 500, done);
  container.dispatchEvent(new Event("wheel"));
  container.scrollTop = 120;
  container.firstElementChild!.setAttribute("data-scroll-pending", "false");
  await Promise.resolve();
  expect(container.scrollTop).toBe(120);
  expect(done).toHaveBeenCalledTimes(1);
});

it("animates all scrolling regions to the top before completing refresh", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  document.body.innerHTML = '<div><textarea></textarea></div><aside></aside>';
  const nodes = Array.from(document.querySelectorAll("div, textarea, aside"));
  nodes.forEach(element => { element.scrollTop = 500; });
  const done = vi.fn();
  scrollPageToTop(done, vi.fn());
  vi.advanceTimersByTime(160);
  expect(done).not.toHaveBeenCalled();
  expect(nodes.every(element => element.scrollTop > 0 && element.scrollTop < 500)).toBe(true);
  vi.advanceTimersByTime(200);
  expect(nodes.every(element => element.scrollTop === 0)).toBe(true);
  expect(done).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels refresh motion on user scrolling and honors reduced motion", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  document.body.innerHTML = '<div></div>';
  const node = document.querySelector("div")!;
  node.scrollTop = 500;
  const done = vi.fn(), interrupted = vi.fn();
  scrollPageToTop(done, interrupted);
  window.dispatchEvent(new Event("wheel"));
  vi.advanceTimersByTime(500);
  expect(done).not.toHaveBeenCalled();
  expect(interrupted).toHaveBeenCalledTimes(1);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  scrollPageToTop(done, interrupted);
  vi.advanceTimersByTime(20);
  expect(node.scrollTop).toBe(0);
  expect(done).toHaveBeenCalledTimes(1);
});
