"use client";

import { useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { AuthUser } from "@/lib/api";
import { CameraIcon } from "@/components/Icons";

const cardStyle = { padding: "2rem" } as const;
const labelStyle = {
  display: "block",
  marginBottom: "0.5rem",
  fontSize: "0.9rem",
  color: "var(--text-secondary)",
} as const;
const inputStyle = {
  width: "100%",
  padding: "0.8rem 1rem",
  background: "var(--bg-base)",
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  outline: "none",
} as const;
const actionButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  padding: "0.7rem 1.5rem",
  fontSize: "0.9rem",
  fontWeight: 500,
  cursor: "pointer",
} as const;

interface ProfileSummaryProps {
  user: AuthUser;
  profileName: string;
  profileTag: string;
  profileAvatar: string;
  avatarFailed: boolean;
  avatarUploading: boolean;
  message: string;
  onAvatarUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onAvatarError: () => void;
}

export function ProfileSummary({
  user,
  profileName,
  profileTag,
  profileAvatar,
  avatarFailed,
  avatarUploading,
  message,
  onAvatarUpload,
  onAvatarError,
}: ProfileSummaryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayName = profileName.trim() || user.username;
  const failed = message.startsWith("❌");

  return (
    <section className="ai-card" style={cardStyle} aria-labelledby="profile-summary-heading">
      <h2 id="profile-summary-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600 }}>
        Personal Profile
      </h2>
      <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={avatarUploading}
          aria-label={avatarUploading ? "Uploading profile avatar" : "Choose a new profile avatar"}
          style={{
            cursor: avatarUploading ? "wait" : "pointer",
            position: "relative",
            padding: 0,
            border: 0,
            borderRadius: "50%",
            background: "transparent",
          }}
        >
          <span
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: profileAvatar ? "transparent" : "var(--accent-blue)",
              color: "var(--accent-contrast-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "2rem",
              fontWeight: 600,
              position: "relative",
              overflow: "hidden",
              border: "2px solid var(--border-color)",
            }}
          >
            {profileAvatar && !avatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileAvatar}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={onAvatarError}
              />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </span>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              background: "var(--accent-blue)",
              color: "var(--accent-contrast-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--bg-surface)",
            }}
          >
            {avatarUploading ? "…" : <CameraIcon size={14} />}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={onAvatarUpload}
          disabled={avatarUploading}
          aria-label="Profile avatar file"
        />
        <div>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.3rem" }}>{displayName}</h3>
          <span
            style={{
              background: "rgba(168, 199, 250, 0.15)",
              color: "var(--accent-blue)",
              padding: "4px 10px",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            {(profileTag || user.role || "admin").trim()}
          </span>
        </div>
      </div>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          aria-live={failed ? "assertive" : "polite"}
          style={{ margin: "1rem 0 0", fontSize: "0.85rem", color: failed ? "var(--accent-red)" : "var(--accent-green)" }}
        >
          {message}
        </p>
      )}
    </section>
  );
}

interface ProfileFormProps {
  profileName: string;
  profileDescription: string;
  profileTag: string;
  saving: boolean;
  message: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ProfileForm({
  profileName,
  profileDescription,
  profileTag,
  saving,
  message,
  onNameChange,
  onDescriptionChange,
  onTagChange,
  onSubmit,
}: ProfileFormProps) {
  const failed = message.startsWith("❌");

  return (
    <section className="ai-card" style={cardStyle} aria-labelledby="profile-form-heading">
      <h2 id="profile-form-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600 }}>
        Profile Configuration
      </h2>
      <form onSubmit={onSubmit} aria-busy={saving}>
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="profile-name" style={labelStyle}>Profile Name</label>
          <input
            id="profile-name"
            value={profileName}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={255}
            autoComplete="name"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="profile-description" style={labelStyle}>Profile Description</label>
          <textarea
            id="profile-description"
            value={profileDescription}
            onChange={(event) => onDescriptionChange(event.target.value)}
            maxLength={500}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="profile-tag" style={labelStyle}>Profile Tag</label>
          <input
            id="profile-tag"
            value={profileTag}
            onChange={(event) => onTagChange(event.target.value)}
            maxLength={100}
            placeholder="admin"
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              ...actionButtonStyle,
              background: "var(--accent-blue)",
              color: "var(--accent-contrast-text)",
              borderColor: "transparent",
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          {message && (
            <span
              role={failed ? "alert" : "status"}
              aria-live={failed ? "assertive" : "polite"}
              style={{ fontSize: "0.9rem", color: failed ? "var(--accent-red)" : "var(--accent-green)" }}
            >
              {message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

interface SecurityFormProps {
  currentPassword: string;
  newPassword: string;
  loading: boolean;
  message: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function SecurityForm({
  currentPassword,
  newPassword,
  loading,
  message,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onSubmit,
}: SecurityFormProps) {
  const failed = message.startsWith("❌");

  return (
    <section className="ai-card" style={cardStyle} aria-labelledby="security-heading">
      <h2 id="security-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600 }}>Security</h2>
      <form onSubmit={onSubmit} aria-busy={loading}>
        <div className="settings-password-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <label htmlFor="current-password" style={labelStyle}>Current Password</label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.target.value)}
              autoComplete="current-password"
              required
              aria-describedby="password-requirements"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="new-password" style={labelStyle}>New Password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => onNewPasswordChange(event.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              aria-describedby="password-requirements"
              style={inputStyle}
            />
          </div>
        </div>
        <p id="password-requirements" style={{ margin: "-0.75rem 0 1.5rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Use 12–128 characters (up to 72 UTF-8 bytes). Avoid common passwords and do not include your username.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={loading}
            style={{ ...actionButtonStyle, background: "var(--bg-base)", color: "var(--text-primary)", cursor: loading ? "wait" : "pointer" }}
          >
            {loading ? "Updating..." : "Update Password"}
          </button>
          {message && (
            <span
              role={failed ? "alert" : "status"}
              aria-live={failed ? "assertive" : "polite"}
              style={{ fontSize: "0.85rem", color: failed ? "var(--accent-red)" : "var(--accent-green)" }}
            >
              {message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

export function SessionPanel({
  onLogout,
  loading = false,
  error = "",
}: {
  onLogout: () => void;
  loading?: boolean;
  error?: string;
}) {
  return (
    <section className="ai-card" style={{ ...cardStyle, border: "1px solid rgba(242, 139, 130, 0.3)" }} aria-labelledby="session-heading">
      <h2 id="session-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600, color: "var(--accent-red)" }}>Danger Zone</h2>
      <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
        Logging out invalidates your current server session. You will need to re-authenticate to access the editor.
      </p>
      <button
        type="button"
        onClick={onLogout}
        disabled={loading}
        aria-describedby={error ? "session-logout-error" : undefined}
        style={{
          ...actionButtonStyle,
          background: "rgba(242, 139, 130, 0.1)",
          color: "var(--accent-red)",
          borderColor: "rgba(242, 139, 130, 0.2)",
          fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Logging Out..." : error ? "Try Logout Again" : "Log Out Securely"}
      </button>
      {error && (
        <p
          id="session-logout-error"
          role="alert"
          aria-live="assertive"
          style={{ margin: "1rem 0 0", color: "var(--accent-red)", fontSize: "0.85rem" }}
        >
          {error}
        </p>
      )}
    </section>
  );
}
