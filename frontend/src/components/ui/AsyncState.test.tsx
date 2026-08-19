import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "./AsyncState";

describe("AsyncState", () => {
  it("announces loading and empty states", () => {
    const { rerender } = render(<LoadingState label="Loading files…" rows={2} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading files…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");

    rerender(<EmptyState title="No matching files" message="Try another name." />);
    expect(screen.getByRole("status")).toHaveTextContent("No matching files");
    expect(screen.getByRole("status")).toHaveTextContent("Try another name.");
  });

  it("announces failures and retries the failed operation", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="Unable to reach the server" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to reach the server");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("uses an alert only for error status messages", () => {
    const { rerender } = render(<StatusMessage>Saved</StatusMessage>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    rerender(<StatusMessage tone="error">Save failed</StatusMessage>);
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  });
});
