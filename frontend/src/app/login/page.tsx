"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("http://localhost:8080/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      login(data.token, data.user);
      // Redirect to home page instead of editor
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "80vh",
        background: "var(--bg-main)",
      }}
    >
      <div
        className="ai-card fade-in"
        style={{
          width: "100%",
          maxWidth: "450px",
          padding: "3rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-color)",
          borderRadius: "24px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            background: "rgba(168, 199, 250, 0.15)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2rem",
            marginBottom: "1.5rem",
          }}
        >
          🔑
        </div>

        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 500,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem 0",
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--text-muted)",
            marginBottom: "2.5rem",
          }}
        >
          Continue to Blog Studio
        </p>

        <form onSubmit={handleLogin} style={{ width: "100%" }}>
          <div style={{ marginBottom: "1.2rem" }}>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              style={{
                width: "100%",
                padding: "1rem 1.2rem",
                fontSize: "1rem",
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-blue)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{
                width: "100%",
                padding: "1rem 1.2rem",
                fontSize: "1rem",
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-blue)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
            />
          </div>

          {error && (
            <div
              style={{
                color: "var(--accent-red)",
                fontSize: "0.85rem",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>⚠</span> {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "2rem",
            }}
          >
            <a
              href="/"
              style={{
                color: "var(--accent-blue)",
                fontSize: "0.9rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Return Home
            </a>

            <button
              type="submit"
              disabled={loading}
              style={{
                background: "var(--accent-blue)",
                color: "#fff",
                border: "none",
                padding: "0.7rem 1.5rem",
                borderRadius: "8px",
                fontSize: "0.95rem",
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Signing in..." : "Next"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
