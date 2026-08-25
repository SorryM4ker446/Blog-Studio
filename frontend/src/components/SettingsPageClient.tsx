"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import {
  getSettings,
  getApiErrorMessage,
  getFileViewUrl,
  normalizeFileViewUrl,
  updateSettings,
  updatePassword,
  uploadFile,
} from "@/lib/api";
import ConfirmModal from "@/components/ConfirmModal";
import { SettingsIcon } from "@/components/Icons";
import { ErrorState, LoadingState } from "@/components/ui/AsyncState";
import {
  AppearancePanel,
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
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [profileName, setProfileName] = useState(initialSettings.profile_name || "");
  const [profileDesc, setProfileDesc] = useState(initialSettings.profile_description || "");
  const [profileTag, setProfileTag] = useState(initialSettings.profile_tag || "admin");
  const [profileAvatar, setProfileAvatar] = useState(normalizeFileViewUrl(initialSettings.profile_avatar || ""));
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState(initialSettingsError);
  const [saving, setSaving] = useState(false);
  const [profileSaveMsg, setProfileSaveMsg] = useState("");
  const [avatarMsg, setAvatarMsg] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
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
      const data = await getSettings();
      if (!isMountedRef.current || requestId !== settingsRequestIdRef.current) return;
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
    setSaving(true);
    setProfileSaveMsg("");
    try {
      const success = await updateSettings({
        profile_name: profileName,
        profile_description: profileDesc,
        profile_tag: profileTag,
      });
      if (!success) throw new Error("Failed to save settings.");
      setProfileSaveMsg("✅ Settings saved successfully!");
      await refreshProfile();
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
    if (!currentPass || !newPass) {
      setPassMsg("❌ Both fields are required.");
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
      completeLogout();
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
        <div style={{ display: "grid", gap: "2rem", maxWidth: "800px" }}>
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
          <SecurityForm
            currentPassword={currentPass}
            newPassword={newPass}
            loading={passLoading}
            message={passMsg}
            onCurrentPasswordChange={setCurrentPass}
            onNewPasswordChange={setNewPass}
            onSubmit={handleChangePassword}
          />
          <AppearancePanel theme={theme} onToggle={toggleTheme} />
          <SessionPanel
            onLogout={() => setShowLogoutModal(true)}
            loading={logoutLoading}
            error={logoutError}
          />
        </div>
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
