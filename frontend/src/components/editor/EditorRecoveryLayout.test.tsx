import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EditorRecoveryLayout from "./EditorRecoveryLayout";

let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  history.replaceState({ routerState: "retained" }, "", "/editor?edit=12");
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

function notices(checking: boolean, owner = 7) {
  return <EditorRecoveryLayout checking={checking} owner={owner}>
    <div data-editor-notice="recovery">Browser copy choices</div>
    <div data-editor-notice="conflict" />
  </EditorRecoveryLayout>;
}

it("records geometry only after discovery and retains unrelated history state", () => {
  document.documentElement.setAttribute("data-initial-editor-loading", "true");
  const view = render(notices(true));
  expect(history.state.blogEditorLayout).toBeUndefined();
  view.rerender(notices(false));
  expect(document.documentElement).not.toHaveAttribute("data-initial-editor-loading");
  expect(history.state.routerState).toBe("retained");
  expect(history.state.blogEditorLayout).toEqual({ version: 2, url: "/editor?edit=12", owner: 7,
    width: innerWidth, height: innerHeight, recovery: 0, conflict: 0, copies: [] });
  expect(JSON.stringify(history.state)).not.toContain("Browser copy choices");
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "false");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it("retains recovery titles and dates without storing editable content or actionable copies", () => {
  render(<EditorRecoveryLayout checking={false} owner={7}>
    <div data-editor-notice="recovery"><div data-recovery-shell data-leaving="false">
      <div data-recovery-copy="0"><p data-recovery-title>Browser title</p><time data-recovery-date>2026/10/03 12:00:00</time></div>
    </div></div>
    <div data-editor-notice="conflict"><textarea defaultValue="Private article body" /></div>
  </EditorRecoveryLayout>);
  expect(history.state.blogEditorLayout.copies).toEqual([{ title: "Browser title", date: "2026/10/03 12:00:00" }]);
  expect(JSON.stringify(history.state)).not.toContain("Private article body");
});

it("cannot overwrite another route's layout with an obsolete resize", () => {
  render(notices(false));
  history.replaceState({ blogEditorLayout: "destination layout" }, "", "/drive");
  resize();
  expect(history.state.blogEditorLayout).toBe("destination layout");
});

it("waits for structural animation and ignores completion after replacement", async () => {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const cancel = vi.fn();
  const view = render(notices(true));
  const slot = view.container.querySelector<HTMLElement>('[data-editor-notice="recovery"]')!;
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ height: 380 } as DOMRect);
  Object.defineProperty(slot, "animate", { value: vi.fn(() => ({ finished, cancel })) });
  view.rerender(notices(false));
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "true");
  view.rerender(notices(true));
  expect(cancel).toHaveBeenCalled();
  await act(async () => finish());
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "true");
  expect(history.state.blogEditorLayout).toBeUndefined();
});

it("releases scroll restoration when the animation completes", async () => {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const view = render(notices(true));
  const slot = view.container.querySelector<HTMLElement>('[data-editor-notice="recovery"]')!;
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({ height: 380 } as DOMRect);
  Object.defineProperty(slot, "animate", { value: vi.fn(() => ({ finished, cancel: vi.fn() })) });
  view.rerender(notices(false));
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "true");
  expect(slot.inert).toBe(true);
  await act(async () => finish());
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "false");
  expect(slot.inert).toBe(false);
  expect(history.state.blogEditorLayout.recovery).toBe(380);
});

it("keeps recovery actions inactive until the window entrance and layout transfer both finish", async () => {
  let checking = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { height: this.dataset.editorNotice === "conflict" ? (checking ? 620 : 0)
      : this.dataset.editorNotice === "recovery" ? (checking ? 0 : 380) : 0 } as DOMRect;
  });
  const renderNotices = () => <EditorRecoveryLayout checking={checking} owner={7}>
    <div data-editor-notice="recovery"><div data-recovery-shell><section>Browser recovery</section></div></div>
    <div data-editor-notice="conflict" />
  </EditorRecoveryLayout>;
  const view = render(renderNotices());
  const slots = Array.from(view.container.querySelectorAll<HTMLElement>("[data-editor-notice]"));
  const panel = view.container.querySelector("section")!;
  const completions: (() => void)[] = [];
  for (const element of [...slots, panel]) Object.defineProperty(element, "animate", { value: () => ({
    finished: new Promise<void>(resolve => completions.push(resolve)), cancel: vi.fn(),
  }) });
  checking = false;
  view.rerender(renderNotices());
  expect(completions).toHaveLength(3);
  await act(async () => { completions[0](); completions[2](); });
  expect(slots[0].inert).toBe(true);
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "true");
  await act(async () => completions[1]());
  expect(slots[0].inert).toBe(false);
  expect(view.container.firstChild).toHaveAttribute("data-scroll-pending", "false");
});
