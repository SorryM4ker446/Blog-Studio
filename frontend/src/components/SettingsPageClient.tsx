"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useEditorRouter as useRouter } from "@/lib/use-editor-router";
import { useAuth } from "@/context/AuthContext";
import {
  getSettings,
  getApiErrorMessage,
  getFileViewUrl,
  normalizeFileViewUrl,
  updateSettings,
  updatePassword,
  uploadFile,
} from "@/lib/api";
import ModalSurface from "@/components/ModalSurface";
import "./settings/settings.css";
import ConfirmModal from "@/components/ConfirmModal";
import { SettingsIcon } from "@/components/Icons";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";
import {
  ProfileForm,
  ProfileSummary,
  SecurityForm,
  SessionPanel,
} from "@/components/settings/SettingsSections";

export default function SettingsPageClient({
  initialSettings,
  initialSettingsError = "",
}: {
  initialSettings: Record<string, string>;
  initialSettingsError?: string;
}) {
  const { user, logout, completeLogout, isLoading, refreshProfile, authStatus, authError, refreshAuth } = useAuth();
  const router = useRouter();

  const [profileName, setProfileName] = useState(initialSettings.profile_name || "");
  const [profileDesc, setProfileDesc] = useState(initialSettings.profile_description || "");
  const [profileTag, setProfileTag] = useState(initialSettings.profile_tag || "admin");
  const [profileAvatar, setProfileAvatar] = useState(normalizeFileViewUrl(initialSettings.profile_avatar || ""));
  const [savedProfile, setSavedProfile] = useState({ name: initialSettings.profile_name || "", description: initialSettings.profile_description || "", tag: initialSettings.profile_tag || "admin" });
  const [activePanel, setActivePanel] = useState<"profile" | "security" | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  function openPanel(panel: "profile" | "security") {
    setProfileSaved(false);
    setProfileName(savedProfile.name); setProfileDesc(savedProfile.description); setProfileTag(savedProfile.tag);
    setProfileSaveMsg(""); setAvatarMsg(""); setPassMsg("");
    setCurrentPass(""); setNewPass(""); setPasswordErrors({}); setActivePanel(panel);
  }
  function closePanel() {
    setCurrentPass(""); setNewPass(""); setActivePanel(null);
  }
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState(initialSettingsError);
  const [saving, setSaving] = useState(false);
  const [profileSaveMsg, setProfileSaveMsg] = useState("");
  const [avatarMsg, setAvatarMsg] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<{ current?: string; next?: string }>({});
  const [passMsg, setPassMsg] = useState("");
  const [passLoading, setPassLoading] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const settingsRequestIdRef = useRef(0);
  const logoutInProgressRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    if (!isLoading && authStatus === "anonymous" && !logoutInProgressRef.current) {
      router.replace("/login?redirect=/settings");
    }
  }, [authStatus, isLoading, router]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSettings = useCallback(async () => {
    const requestId = ++settingsRequestIdRef.current;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const data = await getSettings({ fresh: true });
      if (!isMountedRef.current || requestId !== settingsRequestIdRef.current) return;
      setSavedProfile({ name: data.profile_name || "", description: data.profile_description || "", tag: data.profile_tag || user?.role || "admin" });
      setProfileName(data.profile_name || "");
      setProfileDesc(data.profile_description || "");
      setProfileTag(data.profile_tag || user?.role || "admin");
      setProfileAvatar(normalizeFileViewUrl(data.profile_avatar || ""));
      setFailedAvatarUrl("");
    } catch (error) {
      if (!isMountedRef.current || requestId !== settingsRequestIdRef.current) return;
      setSettingsError(getApiErrorMessage(error, "Failed to load settings."));
    } finally {
      if (isMountedRef.current && requestId === settingsRequestIdRef.current) {
        setSettingsLoading(false);
      }
    }
  }, [user]);

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if ([...profileName].length > 20 || [...profileDesc].length > 100) {
      setProfileSaveMsg("❌ Use at most 20 characters for the name and 100 for the description.");
      event.currentTarget.querySelector<HTMLElement>([...profileName].length > 20 ? "#profile-name" : "#profile-description")?.focus();
      return;
    }
    setSaving(true);
    setProfileSaveMsg("");
    try {
      const success = await updateSettings({
        profile_name: profileName,
        profile_description: profileDesc,
        profile_tag: profileTag,
      });
      if (!success) throw new Error("Failed to save settings.");
      setSavedProfile({ name: profileName, description: profileDesc, tag: profileTag });
      await refreshProfile();
      setProfileSaved(true);
    } catch (error) {
      setProfileSaveMsg(`❌ ${getApiErrorMessage(error, "Failed to save settings.")}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return;
    setAvatarUploading(true);
    setAvatarMsg("");
    try {
      const uploaded = await uploadFile(event.target.files[0], true);
      if (!uploaded) throw new Error("Failed to upload avatar.");
      const avatarUrl = getFileViewUrl(uploaded.id);
      const saved = await updateSettings({ profile_avatar: avatarUrl });
      if (!saved) throw new Error("The avatar was uploaded but could not be saved to your profile.");
      setProfileAvatar(avatarUrl);
      setFailedAvatarUrl("");
      await refreshProfile();
      setAvatarMsg("✅ Avatar updated!");
    } catch (error) {
      setAvatarMsg(`❌ ${getApiErrorMessage(error, "Failed to upload avatar.")}`);
    } finally {
      setAvatarUploading(false);
      event.target.value = "";
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passLoading) return;
    const errors: { current?: string; next?: string } = {};
    if (!currentPass) errors.current = "Enter your current password.";
    if (!newPass) errors.next = "Enter a new password.";
    else if ([...newPass].length < 12 || [...newPass].length > 128) errors.next = "Use 12–128 characters.";
    else if (new TextEncoder().encode(newPass).length > 72) errors.next = "Use at most 72 UTF-8 bytes.";
    setPasswordErrors(errors);
    setPassMsg("");
    if (errors.current || errors.next) {
      event.currentTarget.querySelector<HTMLInputElement>(errors.current ? "#current-password" : "#new-password")?.focus();
      return;
    }
    setPassLoading(true);
    setPassMsg("");
    try {
      const result = await updatePassword(currentPass, newPass);
      if (!result.success) {
        setPassMsg(`❌ ${result.error || "Failed to update."}`);
        return;
      }
      setPassMsg("✅ Password updated. Please sign in again.");
      setCurrentPass("");
      setNewPass("");
      logoutInProgressRef.current = true;
      await completeLogout();
    } catch (error) {
      setPassMsg(`❌ ${getApiErrorMessage(error, "Failed to update password.")}`);
    } finally {
      setPassLoading(false);
    }
  }

  async function handleLogout() {
    if (logoutLoading) return;
    logoutInProgressRef.current = true;
    setShowLogoutModal(false);
    setLogoutLoading(true);
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      logoutInProgressRef.current = false;
      if (isMountedRef.current) {
        setLogoutError(getApiErrorMessage(error, "Logout could not be confirmed. Please try again."));
      }
    } finally {
      if (isMountedRef.current) {
        setLogoutLoading(false);
      }
    }
  }

  if (isLoading || authStatus === "checking" || authStatus === "anonymous") {
    return <LoadingState label="Checking your account…" rows={2} />;
  }
  if (authStatus === "unavailable") {
    return (
      <ErrorState
        title="Settings access could not be verified"
        message={getApiErrorMessage(authError, "The server could not verify your session.")}
        onRetry={() => void refreshAuth()}
      />
    );
  }
  if (!user) {
    return <ErrorState title="Account unavailable" message="The current account could not be loaded." />;
  }

  const isAdmin = user.role === "admin";

  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <SettingsIcon size={28} /> Settings
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Manage your account and platform preferences.
        </p>
      </header>

      {!isAdmin ? (
        <div style={{ display: "grid", gap: "2rem", maxWidth: "800px" }}>
          <ErrorState title="Administrator access required" message="This account cannot change site settings." />
          <SessionPanel
            onLogout={() => setShowLogoutModal(true)}
            loading={logoutLoading}
            error={logoutError}
          />
        </div>
      ) : settingsLoading ? (
        <LoadingState label="Loading settings…" rows={4} />
      ) : settingsError ? (
        <ErrorState title="Settings could not be loaded" message={settingsError} onRetry={() => void loadSettings()} />
      ) : (
        <div className="settings-panel">
          <div className="settings-identity">
            <span className="settings-avatar" aria-hidden="true">
              {profileAvatar && failedAvatarUrl !== profileAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileAvatar} alt="" onError={() => setFailedAvatarUrl(profileAvatar)} />
              ) : (savedProfile.name.trim() || user.username).charAt(0).toUpperCase()}
            </span>
            <div><h2>{savedProfile.name.trim() || user.username}</h2><span className="settings-profile-tag">{savedProfile.tag || user.role}</span></div>
          </div>
          <div className="settings-row">
            <div><h2>Profile</h2><p>Your avatar, display name and introduction.</p></div>
            <button type="button" className="settings-action" onClick={() => openPanel("profile")}>Edit profile</button>
          </div>
          <div className="settings-row">
            <div><h2>Security</h2><p>Update the password used to sign in.</p></div>
            <button type="button" className="settings-action" onClick={() => openPanel("security")}>Change password</button>
          </div>
          <SessionPanel onLogout={() => setShowLogoutModal(true)} loading={logoutLoading} error={logoutError} />
        </div>
      )}

      {isAdmin && activePanel && (
        <ModalSurface labelledBy="settings-dialog-title" className="settings-dialog" onClose={closePanel} closeRequested={profileSaved} busy={saving || passLoading || avatarUploading}>
          {(close, closing) => <>
            <header className="settings-dialog-header">
              <h2 id="settings-dialog-title">{activePanel === "profile" ? "Edit profile" : "Change password"}</h2>
              <button type="button" className="settings-close" aria-label="Close settings dialog" disabled={saving || passLoading || avatarUploading || closing} onClick={close}><span aria-hidden="true">×</span></button>
            </header>
            <fieldset className="settings-dialog-fields" disabled={saving || passLoading || avatarUploading || closing}>
              {activePanel === "profile" ? <>
                <ProfileSummary
                  user={user}
                  profileName={profileName}
                  profileTag={profileTag}
                  profileAvatar={profileAvatar}
                  avatarFailed={Boolean(profileAvatar && failedAvatarUrl === profileAvatar)}
                  avatarUploading={avatarUploading}
                  message={avatarMsg}
                  onAvatarUpload={handleAvatarUpload}
                  onAvatarError={() => setFailedAvatarUrl(profileAvatar)}
                />
                <p className="settings-avatar-note">Avatar changes are saved immediately.</p>
                <ProfileForm
                  profileName={profileName}
                  profileDescription={profileDesc}
                  profileTag={profileTag}
                  saving={saving}
                  message={profileSaveMsg}
                  onNameChange={setProfileName}
                  onDescriptionChange={setProfileDesc}
                  onTagChange={setProfileTag}
                  onSubmit={handleSaveSettings}
                />
              </> : (
                <SecurityForm
                  currentPassword={currentPass}
                  newPassword={newPass}
                  loading={passLoading}
                  message={passMsg}
                  errors={passwordErrors}
                  onCurrentPasswordChange={value => { setCurrentPass(value); setPasswordErrors(errors => ({ ...errors, current: undefined })); setPassMsg(""); }}
                  onNewPasswordChange={value => { setNewPass(value); setPasswordErrors(errors => ({ ...errors, next: undefined })); setPassMsg(""); }}
                  onSubmit={handleChangePassword}
                />
              )}
            </fieldset>
          </>}
        </ModalSurface>
      )}

      <ConfirmModal
        isOpen={showLogoutModal}
        onConfirm={() => void handleLogout()}
        onCancel={() => setShowLogoutModal(false)}
        title="Confirm Logout"
        message="Are you sure you want to log out? You will need to sign in again to manage your blog."
        confirmText="Log Out"
        type="danger"
      />
    </div>
  );
}
