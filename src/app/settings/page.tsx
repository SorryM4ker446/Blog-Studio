"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { getSettings, updateSettings, updatePassword, uploadFile } from "@/lib/api";

export default function SettingsPage() {
  const { user, logout, isLoading, refreshProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [profileName, setProfileName] = useState("");
  const [profileDesc, setProfileDesc] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login?redirect=/settings");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  async function loadSettings() {
    const data = await getSettings();
    setProfileName(data["profile_name"] || "");
    setProfileDesc(data["profile_description"] || "");
    setProfileAvatar(data["profile_avatar"] || "");
  }

  async function handleSaveSettings() {
    setSaving(true);
    setSaveMsg("");
    const success = await updateSettings({
      profile_name: profileName,
      profile_description: profileDesc,
      profile_avatar: profileAvatar,
    });
    setSaving(false);
    if (success) {
      setSaveMsg("✅ Settings saved successfully!");
      refreshProfile(); // Trigger global sync
    } else {
      setSaveMsg("❌ Failed to save settings.");
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setAvatarUploading(true);
    const file = e.target.files[0];
    const res = await uploadFile(file, true);
    if (res) {
      // Build the download URL from the uploaded file
      const avatarUrl = `http://localhost:8080/api/files/${res.id}/download`;
      setProfileAvatar(avatarUrl);
      // Auto-save avatar setting
      await updateSettings({ profile_avatar: avatarUrl });
      await refreshProfile(); // Trigger global sync
      setSaveMsg("✅ Avatar updated!");
    } else {
      setSaveMsg("❌ Failed to upload avatar.");
    }
    setAvatarUploading(false);
    e.target.value = "";
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPass || !newPass) {
      setPassMsg("❌ Both fields are required.");
      return;
    }
    setPassLoading(true);
    setPassMsg("");
    const res = await updatePassword(currentPass, newPass);
    setPassLoading(false);
    if (res.success) {
      setPassMsg("✅ Password updated successfully!");
      setCurrentPass("");
      setNewPass("");
    } else {
      setPassMsg(`❌ ${res.error || "Failed to update."}`);
    }
  }

  if (isLoading || !user) {
    return (
      <div className="fade-in" style={{ padding: "5rem", textAlign: "center" }}>
        <div className="skeleton-pulse" style={{ width: "200px", height: "24px", margin: "0 auto 1rem" }} />
        <div className="skeleton-pulse" style={{ width: "300px", height: "16px", margin: "0 auto" }} />
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: "2rem" }}>
        <h1 className="page-title">⚙️ Settings</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Manage your account and platform preferences.
        </p>
      </div>

      <div style={{ display: "grid", gap: "2rem", maxWidth: "800px" }}>
        {/* Profile Card */}
        <div className="ai-card" style={{ padding: "2rem" }}>
          <h2 style={{ margin: "0 0 1.5rem 0", fontSize: "1.2rem", fontWeight: 600 }}>Personal Profile</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            {/* Avatar with upload */}
            <label
              style={{
                cursor: avatarUploading ? "not-allowed" : "pointer",
                position: "relative",
              }}
              title="Click to change avatar"
            >
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  background: profileAvatar ? "transparent" : "var(--accent-blue)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  fontWeight: 600,
                  overflow: "hidden",
                  border: "2px solid var(--border-color)",
                  transition: "opacity 0.2s",
                }}
              >
                {profileAvatar ? (
                  <img
                    src={profileAvatar}
                    alt="avatar"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  user.username.charAt(0).toUpperCase()
                )}
              </div>
              {/* Upload overlay */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: "var(--accent-blue)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  border: "2px solid var(--bg-surface)",
                }}
              >
                {avatarUploading ? "…" : "📷"}
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarUpload}
                disabled={avatarUploading}
              />
            </label>
            <div>
              <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.3rem" }}>Alter</h3>
              <span
                style={{
                  background: "rgba(168, 199, 250, 0.15)",
                  color: "var(--accent-blue)",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {user.role}
              </span>
            </div>
          </div>
        </div>

        {/* Profile Configuration */}
        <div className="ai-card" style={{ padding: "2rem" }}>
          <h2 style={{ margin: "0 0 1.5rem 0", fontSize: "1.2rem", fontWeight: 600 }}>Profile Configuration</h2>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Profile Name
            </label>
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              style={{
                width: "100%",
                padding: "0.8rem 1rem",
                background: "var(--bg-base)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Profile Description
            </label>
            <textarea
              value={profileDesc}
              onChange={(e) => setProfileDesc(e.target.value)}
              placeholder=""
              rows={3}
              style={{
                width: "100%",
                padding: "0.8rem 1rem",
                background: "var(--bg-base)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              style={{
                background: "var(--accent-blue)",
                color: "#fff",
                border: "none",
                padding: "0.7rem 1.5rem",
                borderRadius: "8px",
                fontSize: "0.9rem",
                fontWeight: 500,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
            {saveMsg && <span style={{ fontSize: "0.9rem", color: saveMsg.includes("✅") ? "var(--accent-green)" : "var(--accent-red)" }}>{saveMsg}</span>}
          </div>
        </div>

        {/* Security Section */}
        <div className="ai-card" style={{ padding: "2rem" }}>
          <h2 style={{ margin: "0 0 1.5rem 0", fontSize: "1.2rem", fontWeight: 600 }}>Security</h2>
          <form onSubmit={handleChangePassword}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>Current Password</label>
                <input
                  type="password"
                  value={currentPass}
                  onChange={e => setCurrentPass(e.target.value)}
                  style={{ width: "100%", padding: "0.8rem", background: "var(--bg-base)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>New Password</label>
                <input
                  type="password"
                  value={newPass}
                  onChange={e => setNewPass(e.target.value)}
                  style={{ width: "100%", padding: "0.8rem", background: "var(--bg-base)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-primary)" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <button
                type="submit"
                disabled={passLoading}
                style={{
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  padding: "0.7rem 1.5rem",
                  borderRadius: "8px",
                  cursor: passLoading ? "not-allowed" : "pointer",
                  fontSize: "0.9rem"
                }}
              >
                {passLoading ? "Updating..." : "Update Password"}
              </button>
              {passMsg && <span style={{ fontSize: "0.85rem", color: passMsg.includes("✅") ? "var(--accent-green)" : "var(--accent-red)" }}>{passMsg}</span>}
            </div>
          </form>
        </div>

        {/* Appearance Settings */}
        <div className="ai-card" style={{ padding: "2rem" }}>
          <h2 style={{ margin: "0 0 1.5rem 0", fontSize: "1.2rem", fontWeight: 600 }}>Appearance</h2>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 500 }}>System Theme</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Toggle between dark and light modes.
              </div>
            </div>
            <button
              onClick={toggleTheme}
              style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border-color)",
                color: "var(--text-primary)",
                padding: "0.6rem 1.2rem",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontWeight: 500,
              }}
            >
              {theme === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode"}
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="ai-card" style={{ padding: "2rem", border: "1px solid rgba(242, 139, 130, 0.3)" }}>
          <h2 style={{ margin: "0 0 1.5rem 0", fontSize: "1.2rem", fontWeight: 600, color: "var(--accent-red)" }}>Danger Zone</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
            Logging out will clear your current session token. You will need to re-authenticate to access the editor.
          </p>
          <button
            onClick={() => {
              if (confirm("Are you sure you want to log out?")) {
                logout();
              }
            }}
            style={{
              background: "rgba(242, 139, 130, 0.1)",
              color: "var(--accent-red)",
              border: "1px solid rgba(242, 139, 130, 0.2)",
              padding: "0.7rem 1.5rem",
              borderRadius: "8px",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Log Out Securely
          </button>
        </div>
      </div>
    </div>
  );
}
