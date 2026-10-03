import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { FileRecord, UploadProgress } from "@/lib/api";
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
  await waitFor(() => expect(onUpload).toHaveBeenCalledWith(chosen, "名".repeat(25), "介".repeat(100), expect.any(Function)));
});

it("shows actual transfer progress only after upload starts and clears it after a failed attempt", async () => {
  let reportProgress: (progress: UploadProgress | null) => void = () => undefined;
  let finishUpload: (result: { ok: boolean; error?: string }) => void = () => undefined;
  const onUpload = vi.fn((_file: File, _name: string, _description: string, onProgress: typeof reportProgress) => {
    reportProgress = onProgress;
    return new Promise<{ ok: boolean; error?: string }>(resolve => { finishUpload = resolve; });
  });
  render(<FileUploadDialog open onClose={vi.fn()} onUpload={onUpload} />);
  const chosen = new File(["a".repeat(100)], "assets.zip", { type: "application/zip" });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [chosen] } });
  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(within(dialog).getByText("assets.zip")).toBeVisible();
  expect(within(dialog).getByText("100 B · ZIP archive")).toBeVisible();
  expect(within(dialog).getByText("Replace").closest("button")).toBeEnabled();

  fireEvent.click(within(dialog).getByRole("button", { name: /^Upload$/ }));
  const progressbar = within(dialog).getByRole("progressbar");
  expect(progressbar).toHaveAttribute("aria-valuenow", "0");
  expect(progressbar.firstElementChild).toHaveStyle({ width: "0%" });
  expect(within(dialog).getByText("0 B of 100 B")).toBeVisible();
  act(() => reportProgress(null));
  expect(progressbar).toHaveAttribute("aria-valuenow", "0");
  expect(progressbar.firstElementChild).toHaveStyle({ width: "0%" });
  expect(within(dialog).getByRole("button", { name: "Replace" })).toBeDisabled();
  act(() => reportProgress({ loaded: 68, total: 100 }));
  expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");
  expect(within(dialog).getByText("68 B of 100 B")).toBeVisible();
  act(() => reportProgress({ loaded: 100, total: 100 }));
  expect(within(dialog).getByText("Uploading file…")).toBeVisible();
  await waitFor(() => expect(within(dialog).getByText("Processing file…")).toBeVisible(), { timeout: 1200 });

  await act(async () => finishUpload({ ok: false, error: "Upload failed" }));
  expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Upload failed");
  expect(within(dialog).getByRole("button", { name: "Replace" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /^Upload$/ })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: /^Upload$/ }));
  expect(onUpload).toHaveBeenCalledTimes(2);
  expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  expect(within(dialog).getByRole("progressbar").firstElementChild).toHaveStyle({ width: "0%" });
  await act(async () => finishUpload({ ok: false, error: "Upload failed" }));
});

it("keeps unsupported files blocked until a different file is selected", async () => {
  const onUpload = vi.fn().mockResolvedValue({
    ok: false, code: "unsupported_file_type", error: "File extension and content type must match an allowed format",
  });
  render(<FileUploadDialog open onClose={vi.fn()} onUpload={onUpload} />);
  const input = document.querySelector('input[type="file"]')!;
  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  const upload = within(dialog).getByRole("button", { name: "Upload" });

  fireEvent.change(input, { target: { files: [new File(["icon"], "favicon.ico", { type: "image/x-icon" })] } });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("File extension and content type must match an allowed format");
  expect(upload).toBeDisabled();
  fireEvent.click(upload);
  expect(onUpload).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { files: [new File(["not a png"], "favicon.png", { type: "image/png" })] } });
  expect(upload).toBeEnabled();
  fireEvent.click(upload);
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("File extension and content type must match an allowed format"));
  expect(upload).toBeDisabled();
  fireEvent.click(upload);
  expect(onUpload).toHaveBeenCalledTimes(1);
  expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();

  fireEvent.change(input, { target: { files: [new File(["plain text"], "notes.txt", { type: "text/plain" })] } });
  expect(within(dialog).getByRole("alert")).toBeEmptyDOMElement();
  expect(upload).toBeEnabled();
});

it("keeps the upload label stable when the server responds soon after transfer", async () => {
  let reportProgress: (progress: UploadProgress | null) => void = () => undefined;
  let finishUpload: (result: { ok: boolean }) => void = () => undefined;
  const onUpload = vi.fn((_file: File, _name: string, _description: string, onProgress: typeof reportProgress) => {
    reportProgress = onProgress;
    return new Promise<{ ok: boolean }>(resolve => { finishUpload = resolve; });
  });
  const onClose = vi.fn();
  render(<FileUploadDialog open onClose={onClose} onUpload={onUpload} />);
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(["sample"], "sample.txt", { type: "text/plain" })] },
  });
  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Upload$/ }));
  act(() => reportProgress({ loaded: 100, total: 100 }));
  expect(within(dialog).getByText("Uploading file…")).toBeVisible();
  await act(async () => finishUpload({ ok: true }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(within(dialog).queryByText("Processing file…")).not.toBeInTheDocument();
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

it("rejects a file above 1 GiB before upload and accepts one at the limit", async () => {
  const onUpload = vi.fn().mockResolvedValue({ ok: true, file });
  render(<FileUploadDialog open onClose={vi.fn()} onUpload={onUpload} />);
  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  const input = document.querySelector('input[type="file"]')!;
  const oversized = new File(["content"], "large.png", { type: "image/png" });
  Object.defineProperty(oversized, "size", { value: 1024 ** 3 + 1 });
  fireEvent.change(input, { target: { files: [oversized] } });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Each file must be 1 GB or smaller.");
  expect(within(dialog).getByRole("button", { name: "Upload" })).toBeDisabled();
  expect(onUpload).not.toHaveBeenCalled();

  const allowed = new File(["content"], "large.png", { type: "image/png" });
  Object.defineProperty(allowed, "size", { value: 1024 ** 3 });
  fireEvent.change(input, { target: { files: [allowed] } });
  expect(within(dialog).getByText("1.0 GB · PNG image")).toBeVisible();
  expect(within(dialog).getByRole("alert")).toBeEmptyDOMElement();
  expect(within(dialog).getByRole("button", { name: "Upload" })).toBeEnabled();
});

it("labels selected files by their extensions when browser MIME types differ", () => {
  render(<FileUploadDialog open onClose={vi.fn()} onUpload={vi.fn()} />);
  const input = document.querySelector('input[type="file"]')!;
  const chosen = new File(["archive"], "assets.zip", { type: "application/x-zip-compressed" });
  fireEvent.change(input, { target: { files: [chosen] } });

  const dialog = screen.getByRole("dialog", { name: "Upload a file" });
  expect(within(dialog).getByText("7 B · ZIP archive")).toBeVisible();
  fireEvent.change(input, { target: { files: [new File(["a,b"], "data.csv", { type: "application/vnd.ms-excel" })] } });
  expect(within(dialog).getByText("3 B · CSV data")).toBeVisible();
  expect(within(dialog).queryByText(/Other file/)).not.toBeInTheDocument();
});
