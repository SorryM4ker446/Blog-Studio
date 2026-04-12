"use client";

import { useAuth } from "@/context/AuthContext";

export default function TopBar() {
  const { profile, isProfileLoading } = useAuth();

  // If globally loading for the first time, we can show a minimal placeholder
  // but once loaded, it stays in sync without flickering on navigation.
  return (
    <header className="top-bar">
      <div className="top-bar-profile">
        <div className="top-bar-avatar">
          {profile?.avatar ? (
            <img src={profile.avatar} alt="avatar" />
          ) : isProfileLoading ? (
            <div className="skeleton-pulse" style={{ width: "100%", height: "100%", borderRadius: "50%" }} />
          ) : null}
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
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: "1rem",
        }}
      >
        <span 
          style={{ opacity: 0.5, cursor: "pointer" }} 
          onClick={() => window.location.reload()}
          title="Refresh page"
        >
          ⟳
        </span>
        <span style={{ opacity: 0.5, cursor: "pointer" }}>⋮</span>
      </div>
    </header>
  );
}
