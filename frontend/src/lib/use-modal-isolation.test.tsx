import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useModalIsolation } from "./use-modal-isolation";

function Surface({ open }: { open: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalIsolation(panel, open);
  return <div><button>Background action</button><div ref={panel}>Dialog contents</div></div>;
}

describe("modal background isolation", () => {
  it("isolates siblings across ancestors and restores their previous state on close", () => {
    const existing = document.createElement("aside");
    existing.setAttribute("inert", "");
    document.body.append(existing);
    const view = render(<Surface open={false} />);
    const background = screen.getByRole("button");
    const wasInert = background.hasAttribute("inert");
    view.rerender(<Surface open />);
    expect(background).toHaveAttribute("inert");
    expect(screen.getByText("Dialog contents")).not.toHaveAttribute("inert");
    view.rerender(<Surface open={false} />);
    expect(background.hasAttribute("inert")).toBe(wasInert);
    expect(existing).toHaveAttribute("inert");
    existing.remove();
  });
});
