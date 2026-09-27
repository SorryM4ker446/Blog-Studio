import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { FileRecord } from "@/lib/api";
import { FileEditDialog, FileUploadDialog } from "./FileDialogs";

const file: FileRecord = {
  id: 7,
  orig_name: "original-image.png",
  display_name: "Original image",
  description: "",
  size: 12,
  mime_type: "image/png",
  is_system: false,
  created_at: "2026-09-01T00:00:00Z",
};

it("requires a long selected filename to be shortened and caps managed metadata", async () => {
  const onUpload = vi.fn().mockResolvedValue({ ok: true, file });
  render(<FileUploadDialog open onClose={vi.fn()} onUpload={onUpload} />);
  const chosen = new File(["sample"], "an-original-filename-over-the-limit.png", { type: "image/png" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [chosen] } });
  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  const name = within(dialog).getByRole("textbox", { name: /Display name/ });
  const description = within(dialog).getByRole("textbox", { name: /Description/ });
  const upload = within(dialog).getByRole("button", { name: /^Upload$/ });

  expect(name).toHaveValue(chosen.name);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(upload).toBeDisabled();
  fireEvent.change(name, { target: { value: "名".repeat(26) } });
  expect(name).toHaveValue("名".repeat(26));
  expect(upload).toBeDisabled();
  fireEvent.change(name, { target: { value: "名".repeat(25) } });
  fireEvent.change(description, { target: { value: "介".repeat(101) } });
  expect(name).toHaveValue("名".repeat(25));
  expect(description).toHaveValue("介".repeat(100));
  expect(within(dialog).getByText("25/25")).toBeVisible();
  expect(within(dialog).getByText("100/100")).toBeVisible();
  expect(upload).toBeEnabled();
  fireEvent.click(upload);
  await waitFor(() => expect(onUpload).toHaveBeenCalledWith(chosen, "名".repeat(25), "介".repeat(100)));
});

it("keeps legacy metadata intact until it is shortened for a save", async () => {
  const legacy = { ...file, display_name: "名".repeat(26), description: "介".repeat(101) };
  const onSave = vi.fn().mockResolvedValue({ ok: true, file: legacy });
  render(<FileEditDialog file={legacy} onClose={vi.fn()} onSave={onSave} />);
  const dialog = screen.getByRole("dialog", { name: "Edit file details" });
  const name = within(dialog).getByRole("textbox", { name: /Display name/ });
  const description = within(dialog).getByRole("textbox", { name: /Description/ });
  const save = within(dialog).getByRole("button", { name: "Save changes" });

  expect(name).toHaveValue(legacy.display_name);
  expect(description).toHaveValue(legacy.description);
  expect(save).toBeDisabled();
  fireEvent.change(name, { target: { value: "名".repeat(25) } });
  fireEvent.change(description, { target: { value: "介".repeat(100) } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(legacy, "名".repeat(25), "介".repeat(100)));
});
