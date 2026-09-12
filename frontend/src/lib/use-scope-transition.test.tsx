import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScopeTransition } from "./use-scope-transition";

interface Value { scope: string; error: string; title: string }
const initial: Value = { scope: "all", error: "", title: "Original results" };
function Probe({ value = initial, scope = "all", pending = false }: { value?: Value; scope?: string; pending?: boolean }) {
  const { displayed, ref, changing } = useScopeTransition(value, scope, pending);
  return <section ref={ref} inert={changing} style={{ opacity: 1 }}>{displayed.error || displayed.title}</section>;
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
beforeEach(() => Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
});

describe("search scope presentation", () => {
  it("cancels an obsolete exit callback before it can reveal the wrong scope", () => {
    const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
    vi.spyOn(Element.prototype, "animate").mockImplementation(() => {
      const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    const view = render(<Probe />);
    const posts = { ...initial, scope: "posts", title: "Posts response" };
    view.rerender(<Probe value={posts} scope="posts" />);
    const obsolete = animations.at(-1)!;
    expect(screen.getByText(initial.title)).toHaveAttribute("inert");
    view.rerender(<Probe value={posts} scope="files" pending />);
    expect(obsolete.cancel).toHaveBeenCalled();
    act(() => obsolete.onfinish?.());
    expect(screen.queryByText(posts.title)).not.toBeInTheDocument();
    const files = { ...initial, scope: "files", title: "Latest files" };
    view.rerender(<Probe value={files} scope="files" />);
    act(() => animations.at(-1)!.onfinish?.());
    expect(screen.getByText(files.title)).not.toHaveAttribute("inert");
    view.unmount();
    act(() => obsolete.onfinish?.());
    expect(screen.queryByText(posts.title)).not.toBeInTheDocument();
  });

  it("keeps failures recoverable when their response snapshot still has the previous scope", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const view = render(<Probe />);
    view.rerender(<Probe scope="posts" pending />);
    view.rerender(<Probe value={{ ...initial, error: "Retry this search" }} scope="posts" />);
    expect(screen.getByText("Retry this search")).not.toHaveAttribute("inert");
    expect(screen.getByText("Retry this search")).toHaveStyle({ opacity: "1" });
    view.rerender(<Probe value={{ ...initial, scope: "posts", title: "Recovered posts" }} scope="posts" />);
    expect(screen.getByText("Recovered posts")).not.toHaveAttribute("inert");
  });

  it("updates without animation support and leaves ordinary page updates immediate", () => {
    Object.defineProperty(Element.prototype, "animate", { value: undefined });
    const view = render(<Probe />);
    view.rerender(<Probe value={{ ...initial, scope: "files", title: "Files page 1" }} scope="files" />);
    expect(screen.getByText("Files page 1")).toHaveStyle({ opacity: "1" });
    view.rerender(<Probe value={{ ...initial, scope: "files", title: "Files page 2" }} scope="files" />);
    expect(screen.getByText("Files page 2")).not.toHaveAttribute("inert");
  });
});
