import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SearchPending from "./SearchPending";

afterEach(() => vi.useRealTimers());

it("announces pending work immediately but only shows feedback for slower requests", () => {
  vi.useFakeTimers();
  const fast = render(<SearchPending />);
  expect(screen.getByRole("status")).toHaveTextContent("Searching posts and files…");
  expect(screen.getByText("Searching posts and files…")).toHaveClass("sr-only");
  act(() => vi.advanceTimersByTime(199));
  expect(screen.getByText("Searching posts and files…")).toHaveClass("sr-only");
  fast.unmount();
  expect(vi.getTimerCount()).toBe(0);
  render(<SearchPending />);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByText("Searching posts and files…")).not.toHaveClass("sr-only");
});
