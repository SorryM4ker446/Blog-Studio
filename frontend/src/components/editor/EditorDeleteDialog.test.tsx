import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EditorDeleteDialog from "./EditorDeleteDialog";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  vi.unstubAllGlobals();
});

function mockMotion() {
  const motions: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: vi.fn(() => {
    const motion = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    motions.push(motion); return motion;
  }) });
  return motions;
}

describe("EditorDeleteDialog", () => {
  it.each(["post", "file", "category", "link"] as const)("keeps the %s dialog and background isolation until exit finishes", resourceType => {
    const motions = mockMotion();
    const trigger = document.createElement("button"); document.body.appendChild(trigger); trigger.focus();
    const props = { open: true, resourceType, busy: false, blocked: false, error: "", onConfirm: vi.fn(), onCancel: vi.fn() };
    const view = render(<EditorDeleteDialog {...props} />);
    expect(motions).toHaveLength(2);
    view.rerender(<EditorDeleteDialog {...props} open={false} resourceType="post" />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(`delete this ${resourceType}`);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(trigger).toHaveAttribute("inert");
    act(() => motions.at(-1)!.onfinish?.());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("inert"); expect(trigger).toHaveFocus(); trigger.remove();
  });

  it("cancels obsolete exit completion when reopened", () => {
    const motions = mockMotion();
    const props = { open: true, resourceType: "link" as const, busy: false, blocked: false, error: "", onConfirm: vi.fn(), onCancel: vi.fn() };
    const view = render(<EditorDeleteDialog {...props} />);
    view.rerender(<EditorDeleteDialog {...props} open={false} />);
    const exit = motions.at(-1)!;
    view.rerender(<EditorDeleteDialog {...props} />);
    expect(exit.cancel).toHaveBeenCalled();
    act(() => exit.onfinish?.());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes immediately when reduced motion is preferred", async () => {
    const motions = mockMotion();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const props = { open: true, resourceType: "file" as const, busy: false, blocked: false, error: "", onConfirm: vi.fn(), onCancel: vi.fn() };
    const view = render(<EditorDeleteDialog {...props} />);
    view.rerender(<EditorDeleteDialog {...props} open={false} />);
    expect(motions).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
  it("keeps a referenced-file error stable and blocks repeated deletion", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <EditorDeleteDialog
        open
        resourceType="file"
        busy={false}
        blocked={false}
        error=""
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    rerender(
      <EditorDeleteDialog
        open
        resourceType="file"
        busy={false}
        blocked
        error="File is referenced by article content or settings"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("referenced by article content");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(
      <EditorDeleteDialog
        open
        resourceType="post"
        busy={false}
        blocked={false}
        error=""
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("keeps focus inside the dialog while deletion is in progress", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const { rerender } = render(
      <EditorDeleteDialog
        open
        resourceType="post"
        busy={false}
        blocked={false}
        error=""
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    rerender(
      <EditorDeleteDialog
        open
        resourceType="post"
        busy
        blocked={false}
        error=""
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveFocus());
    expect(trigger).not.toHaveFocus();
    rerender(
      <EditorDeleteDialog
        open
        resourceType="post"
        busy={false}
        blocked={false}
        error="Temporary storage failure"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    rerender(
      <EditorDeleteDialog
        open={false}
        resourceType="post"
        busy={false}
        blocked={false}
        error=""
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});
