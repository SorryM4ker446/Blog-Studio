"use client";

import { useEffect, useRef, useState } from "react";
import { scrollPageToTop } from "@/lib/restore-scroll";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { MoonIcon, SunIcon } from "@/components/Icons";

export default function TopBar({ navigation }: { navigation?: React.ReactNode }) {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const refresh = useRef<(() => void) | null>(null);
  useEffect(() => () => refresh.current?.(), []);
  const avatarFailed = !!profile?.avatar && failedAvatarUrl === profile.avatar;
  const targetTheme = theme === "dark" ? "Light" : "Dark";

  return (
    <header className="top-bar">
      {navigation}
      <div className="top-bar-profile">
        <div className="top-bar-avatar">
          {profile?.avatar && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar}
              alt={profile?.name ? `${profile.name} avatar` : "Site author avatar"}
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
          {profile?.name && (
            <div className="top-bar-name" style={{ marginBottom: profile.description ? "0" : "0" }}>
              {profile.name}
            </div>
          )}
          {profile?.description && (
            <div className="top-bar-desc">{profile.description}</div>
          )}
        </div>
      </div>
      <div className="top-bar-actions">
        <button
          type="button"
          className="top-bar-action"
          onClick={() => {
            if (refresh.current) return;
            refresh.current = scrollPageToTop(() => {
              refresh.current = null;
              window.location.reload();
            }, () => { refresh.current = null; });
          }}
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

      </div>
    </header>
  );
}
