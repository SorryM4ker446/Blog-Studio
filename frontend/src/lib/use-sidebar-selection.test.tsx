import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useSidebarSelection } from "./use-sidebar-selection";

const route = vi.hoisted(() => ({ pathname: "/editor", search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => route.search }));
beforeEach(() => { route.pathname = "/editor"; route.search = new URLSearchParams(); window.history.replaceState({}, "", "/editor"); });

it("keeps the source selected on detail and restores its history entry after another module", () => {
  const view = renderHook(() => useSidebarSelection());
  route.pathname = "/posts/12";
  window.history.replaceState({}, "", "/posts/12");
  view.rerender();
  expect(view.result.current).toBe("/editor");
  const detailHistory = window.history.state;
  route.pathname = "/search";
  window.history.replaceState({}, "", "/search");
  view.rerender();
  expect(view.result.current).toBe("/search");
  route.pathname = "/posts/12";
  window.history.replaceState(detailHistory, "", "/posts/12");
  view.rerender();
  expect(view.result.current).toBe("/editor");
});

it("retains category selection on detail", () => {
  route.pathname = "/posts"; route.search = new URLSearchParams("category=2");
  const view = renderHook(() => useSidebarSelection());
  route.pathname = "/posts/12"; route.search = new URLSearchParams();
  window.history.replaceState({}, "", "/posts/12");
  view.rerender();
  expect(view.result.current).toBe("/posts?category=2");
});

it("restores a valid source on refresh and ignores an invalid source", () => {
  route.pathname = "/posts/12";
  window.history.replaceState({ blogSidebarSelection: "/search" }, "", "/posts/12");
  document.documentElement.setAttribute("data-initial-sidebar", "/search");
  const view = renderHook(() => useSidebarSelection());
  expect(view.result.current).toBe("/search");
  expect(document.documentElement).not.toHaveAttribute("data-initial-sidebar");
  view.unmount();
  window.history.replaceState({ blogSidebarSelection: "https://example.com" }, "", "/posts/12");
  expect(renderHook(() => useSidebarSelection()).result.current).toBe("/posts");
});
