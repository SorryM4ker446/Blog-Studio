"use client";

import { useRef } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { AuthUser } from "@/lib/api";
import { CameraIcon } from "@/components/Icons";

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

function SettingsFeedback({ message }: { message: string }) {
  const failed = message.startsWith("❌");
  return <span className="settings-feedback" data-tone={failed ? "error" : "success"} role={failed ? "alert" : "status"}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {failed ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3v1" /></> : <path d="m5 12 4 4L19 6" />}
    </svg>
    <span>{message.replace(/^[✅❌]\s*/, "")}</span>
  </span>;
}

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
  return (
    <section className="settings-form-section" aria-labelledby="profile-summary-heading">
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
            flexShrink: 0,
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
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.3rem" }}>{displayName}</h3>
          <span className="settings-profile-tag">{(profileTag || user.role || "admin").trim()}</span>
        </div>
      </div>
      {message && <SettingsFeedback message={message} />}
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
  return (
    <section className="settings-form-section" aria-labelledby="profile-form-heading">
      <h2 id="profile-form-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600 }}>
        Profile Configuration
      </h2>
      <form onSubmit={onSubmit} aria-busy={saving}>
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="profile-name" style={labelStyle}>Profile Name</label>
          <input
            id="profile-name"
            data-autofocus
            value={profileName}
            onChange={(event) => onNameChange(event.target.value)}
            aria-describedby="profile-name-limit"
            autoComplete="name"
            style={inputStyle}
          />
          <p id="profile-name-limit" className="settings-field-hint">{[...profileName].length}/20 characters</p>
        </div>
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="profile-description" style={labelStyle}>Profile Description</label>
          <textarea
            id="profile-description"
            value={profileDescription}
            onChange={(event) => onDescriptionChange(event.target.value)}
            aria-describedby="profile-description-limit"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <p id="profile-description-limit" className="settings-field-hint">{[...profileDescription].length}/100 characters</p>
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
              cursor: "pointer",
            }}
          >
            Save Configuration
          </button>
          {message && <SettingsFeedback message={message} />}
        </div>
      </form>
    </section>
  );
}

interface SecurityFormProps {
  errors?: { current?: string; next?: string };
  currentPassword: string;
  newPassword: string;
  loading: boolean;
  message: string;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function SecurityForm({
  errors = {},
  currentPassword,
  newPassword,
  loading,
  message,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onSubmit,
}: SecurityFormProps) {
  return (
    <section className="settings-form-section" aria-labelledby="security-heading">
      <h2 id="security-heading" style={{ margin: "0 0 1.5rem", fontSize: "1.2rem", fontWeight: 600 }}>Security</h2>
      <form onSubmit={onSubmit} aria-busy={loading} noValidate>
        <div className="settings-password-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <label htmlFor="current-password" style={labelStyle}>Current Password</label>
            <input
              id="current-password"
              data-autofocus
              type="password"
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.target.value)}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(errors.current)}
              aria-describedby={errors.current ? "current-password-error password-requirements" : "password-requirements"}
              style={inputStyle}
            />
            {errors.current && <p id="current-password-error" className="settings-field-error" role="alert">{errors.current}</p>}
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
              aria-invalid={Boolean(errors.next)}
              aria-describedby={errors.next ? "new-password-error password-requirements" : "password-requirements"}
              style={inputStyle}
            />
            {errors.next && <p id="new-password-error" className="settings-field-error" role="alert">{errors.next}</p>}
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
          {message && <SettingsFeedback message={message} />}
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
    <section className="settings-session" aria-labelledby="session-heading">
      <h2 id="session-heading" style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 600 }}>Session</h2>
      <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
        Sign out of your current session.
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
