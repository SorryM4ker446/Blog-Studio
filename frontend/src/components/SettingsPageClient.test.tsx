import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SettingsPageClient from "./SettingsPageClient";

const mocks = vi.hoisted(() => ({ save: vi.fn(), password: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/use-editor-router", () => ({ useEditorRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" }, authStatus: "authenticated", isLoading: false, refreshProfile: mocks.refresh }) }));
vi.mock("@/lib/api", () => ({
  updateSettings: mocks.save, updatePassword: mocks.password,
  normalizeFileViewUrl: (value: string) => value,
  getApiErrorMessage: (error: Error, fallback: string) => error?.message || fallback,
}));
beforeEach(() => { mocks.save.mockResolvedValue(true); mocks.refresh.mockResolvedValue(undefined); });
const initialSettings = { profile_name: "Saved name", profile_description: "Introduction", profile_tag: "Writer" };

it("rejects oversized profile fields and accepts Unicode at the limits", async () => {
  render(<SettingsPageClient initialSettings={initialSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  const name = screen.getByLabelText("Profile Name");
  const description = screen.getByLabelText("Profile Description");
  fireEvent.change(name, { target: { value: "界".repeat(21) } });
  fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "😀".repeat(20) } });
  fireEvent.change(description, { target: { value: "界".repeat(101) } });
  fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(description).toHaveFocus();
  fireEvent.change(description, { target: { value: "😀".repeat(100) } });
  fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ profile_name: "😀".repeat(20), profile_description: "😀".repeat(100) }));
});

it("opens profile editing on demand and discards unsaved text on close", async () => {
  render(<SettingsPageClient initialSettings={initialSettings} />);
  expect(screen.queryByLabelText("Profile Name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByLabelText("Profile Name"), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "Close settings dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  expect(screen.getByLabelText("Profile Name")).toHaveValue("Saved name");
});

it("keeps failed edits retryable, blocks closing during save and retains saved changes", async () => {
  let resolve!: (saved: boolean) => void;
  mocks.save.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
  render(<SettingsPageClient initialSettings={initialSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByLabelText("Profile Name"), { target: { value: "New name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
  expect(screen.getByLabelText("Profile Name")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close settings dialog" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => resolve(false));
  expect(screen.getByRole("alert")).toHaveTextContent("Failed to save");
  expect(screen.getByLabelText("Profile Name")).toHaveValue("New name");
  fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  expect(screen.getByLabelText("Profile Name")).toHaveValue("New name");
});

it("clears password fields when their dialog closes", async () => {
  render(<SettingsPageClient initialSettings={initialSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "test-only-password" } });
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(screen.getByLabelText("Current Password")).toHaveValue("");
  expect(mocks.password).not.toHaveBeenCalled();
});

it("shows inline password validation without submitting invalid values", () => {
  render(<SettingsPageClient initialSettings={initialSettings} />);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  fireEvent.click(screen.getByRole("button", { name: "Update Password" }));
  expect(screen.getByText("Enter your current password.")).toBeInTheDocument();
  expect(screen.getByText("Enter a new password.")).toBeInTheDocument();
  expect(screen.getByLabelText("Current Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Current Password")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "test-only-current" } });
  fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "short" } });
  fireEvent.click(screen.getByRole("button", { name: "Update Password" }));
  expect(screen.getByText("Use 12–128 characters.")).toBeInTheDocument();
  expect(screen.getByLabelText("New Password")).toHaveFocus();
  expect(mocks.password).not.toHaveBeenCalled();
});
