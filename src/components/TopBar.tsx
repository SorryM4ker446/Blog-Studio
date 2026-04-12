"use client";

import { useEffect, useState } from "react";
import { getSettings } from "@/lib/api";

export default function TopBar() {
  const [profile, setProfile] = useState<{
    name: string;
    description: string;
    avatar: string;
  }>({ name: "", description: "", avatar: "" });

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const settings = await getSettings();
    setProfile({
      name: settings["profile_name"] || "",
      description: settings["profile_description"] || "",
      avatar: settings["profile_avatar"] || "",
    });
  }

  return (
    <header className="top-bar">
      <div className="top-bar-profile">
        <div className="top-bar-avatar">
          {profile.avatar ? (
            <img src={profile.avatar} alt="avatar" />
          ) : null}
        </div>
        <div>
          {profile.name && <div className="top-bar-name">{profile.name}</div>}
          {profile.description && (
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
        <span style={{ opacity: 0.5, cursor: "pointer" }}>⟳</span>
        <span style={{ opacity: 0.5, cursor: "pointer" }}>⋮</span>
      </div>
    </header>
  );
}
