"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage, isApiError, loginUser } from "@/lib/api";
import { KeyIcon, AlertIcon } from "@/components/Icons";

function LoginPageContent() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const { login } = useAuth();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const user = await loginUser(username, password);
      login(user);
      router.replace("/");
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 429) {
        setError(err.message || "Too many login attempts.");
        setRetryAfter(Math.max(1, err.retryAfterSeconds || 60));
      } else {
        setError(getApiErrorMessage(err, "Login failed"));
      }
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
          <KeyIcon size={32} />
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

        <form onSubmit={handleLogin} style={{ width: "100%" }} aria-busy={loading}>
          <div style={{ marginBottom: "1.2rem" }}>
            <label htmlFor="login-username" className="sr-only">Username</label>
            <input
              id="login-username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
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
            <label htmlFor="login-password" className="sr-only">Password</label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
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
              role="alert"
              aria-live="assertive"
              style={{
                color: "var(--accent-red)",
                fontSize: "0.85rem",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <AlertIcon size={14} /> {error}{retryAfter > 0 && ` Try again in ${retryAfter} seconds.`}
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
            <Link
              href="/"
              style={{
                color: "var(--accent-blue)",
                fontSize: "0.9rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Return Home
            </Link>

            <button
              type="submit"
              disabled={loading || retryAfter > 0}
              style={{
                background: "var(--accent-blue)",
                color: "var(--accent-contrast-text)",
                border: "none",
                padding: "0.7rem 1.5rem",
                borderRadius: "8px",
                fontSize: "0.95rem",
                fontWeight: 500,
                cursor: loading || retryAfter > 0 ? "not-allowed" : "pointer",
                opacity: loading || retryAfter > 0 ? 0.7 : 1,
              }}
            >
              {loading ? "Signing in..." : retryAfter > 0 ? `Try again in ${retryAfter}s` : "Next"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginPageContent />;
}
