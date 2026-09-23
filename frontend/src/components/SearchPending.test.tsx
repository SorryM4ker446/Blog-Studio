import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SearchPending from "./SearchPending";

afterEach(() => vi.useRealTimers());

it("keeps loading feedback accessible and visually hidden for slow requests", () => {
  vi.useFakeTimers();
  const view = render(<SearchPending />);
  expect(screen.getByRole("status")).toHaveTextContent("Searching posts and files…");
  expect(screen.getByText("Searching posts and files…")).toHaveClass("sr-only");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("Searching posts and files…")).toHaveClass("sr-only");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
