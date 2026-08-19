import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorDeleteDialog from "./EditorDeleteDialog";

describe("EditorDeleteDialog", () => {
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
