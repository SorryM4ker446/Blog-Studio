import { afterEach, expect, it, vi } from "vitest";
import { restoreScroll } from "./restore-scroll";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

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
