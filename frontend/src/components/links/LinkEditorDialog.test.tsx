import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import LinkEditorDialog from "./LinkEditorDialog";

it("validates a new link, retains failed edits, and reuses its request identity on retry", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValueOnce(new Error("Save unavailable")).mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  render(<LinkEditorDialog link={null} onSave={onSave} onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: "Save link" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByLabelText("TITLE")).toHaveFocus();
  await user.type(screen.getByLabelText("TITLE"), "  Documentation  ");
  await user.type(screen.getByLabelText("DESCRIPTION"), "Helpful reference");
  await user.type(screen.getByLabelText("DESTINATION URL"), "https://example.org/docs");
  await user.click(screen.getByRole("button", { name: "book icon" }));
  await user.click(screen.getByRole("button", { name: "green color" }));
  await user.click(screen.getByRole("button", { name: "Save link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
  expect(screen.getByLabelText("TITLE")).toHaveValue("  Documentation  ");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save link" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave.mock.calls[0]).toEqual(onSave.mock.calls[1]);
  expect(onSave.mock.calls[1][0]).toEqual({ title: "Documentation", description: "Helpful reference", url: "https://example.org/docs", icon: "book", color: "green", visible: true });
});

it("allows a hidden link without a destination and blocks dismissal while saving", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const onClose = vi.fn();
  render(<LinkEditorDialog link={null} onSave={onSave} onClose={onClose} />);
  await user.type(screen.getByLabelText("TITLE"), "Private shortcut");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Save link" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledOnce();
  await act(async () => finish());
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
