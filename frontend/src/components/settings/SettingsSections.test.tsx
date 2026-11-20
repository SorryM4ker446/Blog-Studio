import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileForm, ProfileSummary, SecurityForm, SessionPanel } from "./SettingsSections";

describe("settings sections", () => {
  it("announces avatar feedback independently from the profile form", () => {
    const props = {
      user: { id: 1, username: "ada", role: "admin" },
      profileName: "Ada",
      profileTag: "admin",
      profileAvatar: "",
      avatarFailed: false,
      onAvatarUpload: vi.fn(),
      onAvatarError: vi.fn(),
    };
    const { rerender } = render(<ProfileSummary {...props} avatarUploading={false} message="" />);
    const note = screen.getByText("Avatar changes are saved immediately.");

    rerender(<ProfileSummary {...props} avatarUploading message="" />);
    expect(note).toHaveTextContent("Uploading avatar…");

    rerender(<ProfileSummary {...props} avatarUploading={false} message="✅ Avatar updated!" />);
    expect(screen.getByRole("status")).toHaveTextContent("Avatar updated!");
    expect(note).toContainElement(screen.getByRole("status"));

    rerender(<ProfileSummary {...props} avatarUploading={false} message="❌ Avatar upload failed." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Avatar upload failed.");
    expect(note).toContainElement(screen.getByRole("alert"));
  });

  it("associates profile labels and exposes failures as alerts", () => {
    render(
      <ProfileForm
        profileName="Ada"
        profileDescription="Writer"
        profileTag="admin"
        saving={false}
        message="❌ Unable to save."
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onTagChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Profile Name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Profile Description")).toHaveValue("Writer");
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save");
  });

  it("uses password autocomplete and native validation attributes", () => {
    render(
      <SecurityForm
        currentPassword=""
        newPassword=""
        loading={false}
        message=""
        onCurrentPasswordChange={vi.fn()}
        onNewPasswordChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Current Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("New Password")).toHaveAttribute("minlength", "12");
    expect(screen.getByLabelText("New Password")).toBeRequired();
  });

  it("keeps a failed logout retryable and announces the error", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    const { rerender } = render(<SessionPanel onLogout={onLogout} loading error="Server logout failed." />);

    expect(screen.getByRole("button", { name: "Logging Out..." })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Server logout failed.");

    rerender(<SessionPanel onLogout={onLogout} error="Server logout failed." />);
    await user.click(screen.getByRole("button", { name: "Try Logout Again" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
