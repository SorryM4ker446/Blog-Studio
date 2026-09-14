import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { answerNavigationPrompt, registerLeaveGuard, releaseEditorNavigation } from "./editor-navigation";
import { useEditorRouter } from "./use-editor-router";
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => releaseEditorNavigation());
it("forwards clean navigation immediately without losing scroll options", () => {
  const { result } = renderHook(useEditorRouter);
  result.current.push("/posts", { scroll: false });
  result.current.replace("/drive", { scroll: false });
  expect(router.push).toHaveBeenCalledWith("/posts", { scroll: false });
  expect(router.replace).toHaveBeenCalledWith("/drive", { scroll: false });
});
it("checks program pushes and replacements before forwarding their exact options", async () => {
  registerLeaveGuard({ dirty: () => true, busy: () => false, flush: async () => {}, expire: async () => {} });
  const { result } = renderHook(useEditorRouter);
  result.current.push("/drive"); result.current.replace("/settings");
  expect(router.push).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
  await answerNavigationPrompt(false);
  result.current.push("/drive", { scroll: false });
  await answerNavigationPrompt(true);
  result.current.replace("/settings", { scroll: false });
  await answerNavigationPrompt(true);
  expect(router.push).toHaveBeenCalledWith("/drive", { scroll: false });
  expect(router.replace).toHaveBeenCalledWith("/settings", { scroll: false });
  expect(result.current.back).toBe(router.back);
});
