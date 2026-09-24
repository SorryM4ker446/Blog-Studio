import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ModalSurface from "./ModalSurface";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  vi.unstubAllGlobals();
});

function setup(busy = false) {
  const motions: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: () => {
    const motion = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    motions.push(motion); return motion;
  } });
  const onClose = vi.fn();
  const view = render(<ModalSurface onClose={onClose} busy={busy} labelledBy="title" className="dialog">
    {(close, closing) => <><h2 id="title">Edit resource</h2><button onClick={close} disabled={busy || closing}>Cancel</button></>}
  </ModalSurface>);
  return { ...view, motions, onClose };
}

it("keeps background isolation through interrupted entrance and calls close only when exit finishes", () => {
  const { motions, onClose, container, unmount } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(motions[0].cancel).toHaveBeenCalled();
  expect(motions[1].cancel).toHaveBeenCalled();
  expect(container).toHaveAttribute("inert");
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector("[data-modal-overlay]")).toHaveAttribute("data-state", "closing");
  act(() => { motions[3].onfinish?.(); motions[3].onfinish?.(); });
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(container).not.toHaveAttribute("inert");
});

it("does not invoke a stale close callback after unmount", () => {
  const { motions, onClose, unmount } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  unmount();
  act(() => motions[3].onfinish?.());
  expect(onClose).not.toHaveBeenCalled();
});

it("animates a requested close before notifying the owner", () => {
  const { rerender, motions, onClose, container } = setup(true);
  rerender(<ModalSurface onClose={onClose} closeRequested labelledBy="title" className="dialog">
    {(_close, closing) => <><h2 id="title">Edit resource</h2><button disabled={closing}>Save</button></>}
  </ModalSurface>);
  expect(document.querySelector("[data-modal-overlay]")).toHaveAttribute("data-state", "closing");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(container).toHaveAttribute("inert");
  expect(onClose).not.toHaveBeenCalled();
  act(() => motions[3].onfinish?.());
  expect(onClose).toHaveBeenCalledOnce();
});

it("blocks Escape and backdrop dismissal while saving", () => {
  const { onClose } = setup(true);
  fireEvent.keyDown(document, { key: "Escape" });
  const backdrop = document.querySelector("[data-modal-overlay]")!;
  fireEvent.pointerDown(backdrop, { button: 0 }); fireEvent.click(backdrop);
  expect(backdrop).toHaveAttribute("data-state", "open");
  expect(onClose).not.toHaveBeenCalled();
});

it("skips motion when reduced motion is preferred", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { motions, onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(motions).toHaveLength(0);
});
