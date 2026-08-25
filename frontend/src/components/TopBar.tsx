"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MoonIcon, SunIcon } from "@/components/Icons";

export default function TopBar() {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const avatarFailed = !!profile?.avatar && failedAvatarUrl === profile.avatar;
  const targetTheme = theme === "dark" ? "Light" : "Dark";

  // If globally loading for the first time, we can show a minimal placeholder
  // but once loaded, it stays in sync without flickering on navigation.
  return (
    <header className="top-bar">
      <div className="top-bar-profile">
        <div className="top-bar-avatar">
          {profile?.avatar && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar}
              alt="avatar"
              fetchPriority="high"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={() => setFailedAvatarUrl(profile.avatar)}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                background: "rgba(168, 199, 250, 0.15)",
                color: "var(--accent-blue)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              {(profile?.name || "A").trim().charAt(0).toUpperCase() || "A"}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {/* Only render if name exists and is not empty */}
          {profile?.name && (
            <div className="top-bar-name" style={{ marginBottom: profile.description ? "0" : "0" }}>
              {profile.name}
            </div>
          )}
          {/* Only render if description exists and is not empty */}
          {profile?.description && (
            <div className="top-bar-desc">{profile.description}</div>
          )}
        </div>
      </div>
      <div className="top-bar-actions">
        <button
          type="button"
          className="top-bar-action"
          onClick={() => window.location.reload()}
          title="Refresh page"
          aria-label="Refresh page"
        >
          <span aria-hidden="true">⟳</span>
        </button>
        <button
          type="button"
          className="top-bar-action"
          onClick={toggleTheme}
          title={`Switch to ${targetTheme} Mode`}
          aria-label={`Switch to ${targetTheme} Mode`}
        >
          {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
        <button
          type="button"
          className="top-bar-action"
          title="More options"
          aria-label="More options"
        >
          <span aria-hidden="true">⋮</span>
        </button>
      </div>
    </header>
  );
}
