import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BackButton from "./BackButton";

const { back, replace } = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, replace }) }));

describe("Article back navigation", () => {
  it("returns directly to the matching editor and its source filters", () => {
    window.history.replaceState(null, "", "/posts/7?returnTo=%2Feditor%3Fedit%3D7%26q%3Dfilter");
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(replace).toHaveBeenCalledWith("/editor?edit=7&q=filter");
    expect(back).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/posts/7");
  });
  it("opens the post list when a new tab has no previous history", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    render(<BackButton text="←" />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(replace).toHaveBeenCalledWith("/posts");
    expect(back).not.toHaveBeenCalled();
  });

  it("uses browser history to preserve the original list filters and scroll", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });
});
