import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api-client";
import { AuthProvider, useAuth } from "./AuthContext";
import TopBar from "@/components/TopBar";
import { ThemeProvider } from "@/context/ThemeContext";
import { recoveryStorage } from "@/lib/editor-recovery-store";
import type { AuthUser } from "@/lib/app-shell-state";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSettings: vi.fn(),
  logoutUser: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/api", () => ({
  getCurrentUser: mocks.getCurrentUser,
  getSettings: mocks.getSettings,
  logoutUser: mocks.logoutUser,
  normalizeFileViewUrl: (value: string) => value,
}));

function AuthProbe({ onAuth }: { onAuth?: (auth: ReturnType<typeof useAuth>) => void } = {}) {
  const auth = useAuth();
  onAuth?.(auth);
  const { user, profile, authStatus, authError, isLoading, isProfileLoading } = auth;
  return (
    <div>
      <span data-testid="status">{authStatus}</span>
      <span data-testid="user">{user?.username || "none"}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error-kind">{authError?.kind || "none"}</span>
      <span data-testid="profile-name">{profile?.name || "none"}</span>
      <span data-testid="profile-loading">{String(isProfileLoading)}</span>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return <button type="button" onClick={() => void logout().catch(() => undefined)}>Log out</button>;
}

function pendingIdentity() {
  let resolve!: (user: AuthUser | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AuthUser | null>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function renderAuthenticated() {
  let auth!: ReturnType<typeof useAuth>;
  const view = render(<AuthProvider initialState={{
    user: { id: 1, username: "admin", role: "admin" },
    profile: null, profileResolved: true, authStatus: "authenticated",
    authNeedsClientCheck: false, categories: [], categoriesResolved: true,
  }}><AuthProbe onAuth={value => { auth = value; }} /></AuthProvider>);
  return { ...view, auth: () => auth };
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.getSettings.mockReset();
    mocks.logoutUser.mockReset();
    mocks.getSettings.mockResolvedValue({});
    mocks.logoutUser.mockResolvedValue(undefined);
    mocks.replace.mockReset();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a resolved server snapshot without replacing it during hydration", async () => {
    render(
      <AuthProvider initialState={{
        user: { id: 1, username: "admin", role: "admin" },
        profile: {
          name: "Ada",
          description: "Engineer",
          avatar: "http://localhost:8080/api/files/7/view",
          tag: "Admin",
        },
        profileResolved: true,
        authStatus: "authenticated",
        authNeedsClientCheck: false,
        categories: [],
        categoriesResolved: true,
      }}>
        <AuthProbe />
        <ThemeProvider><TopBar /></ThemeProvider>
      </AuthProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Ada");
    expect(screen.getByTestId("profile-loading")).toHaveTextContent("false");
    expect(screen.getByRole("img", { name: "Ada avatar" })).toHaveAttribute(
      "src",
      "http://localhost:8080/api/files/7/view",
    );
    expect(document.querySelector(".skeleton-pulse")).toBeNull();

    await act(async () => Promise.resolve());
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("keeps a legacy session in checking state until the compatibility upgrade completes", async () => {
    let resolveIdentity: ((value: { id: number; username: string; role: string }) => void) | undefined;
    mocks.getCurrentUser.mockReturnValue(new Promise((resolve) => {
      resolveIdentity = resolve;
    }));

    render(
      <AuthProvider initialState={{
        user: null,
        profile: { name: "Ada", description: "", avatar: "", tag: "" },
        profileResolved: true,
        authStatus: "anonymous",
        authNeedsClientCheck: true,
        categories: [],
        categoriesResolved: true,
      }}>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("checking");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Ada");
    expect(screen.getByTestId("profile-loading")).toHaveTextContent("false");

    await act(async () => {
      resolveIdentity?.({ id: 1, username: "admin", role: "admin" });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("admin");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("keeps an authentication-check outage distinct from an anonymous session", async () => {
    mocks.getCurrentUser.mockRejectedValue(new ApiError("Unable to reach the server", {
      kind: "network",
      code: "network_error",
    }));

    render(<AuthProvider><AuthProbe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unavailable"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("network");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps the authenticated state when server logout cannot be confirmed", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
    mocks.logoutUser.mockRejectedValue(new ApiError("Unable to reach the server", {
      kind: "network",
      code: "network_error",
    }));

    render(<AuthProvider><AuthProbe /><LogoutButton /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(mocks.logoutUser).toHaveBeenCalledOnce());

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("admin");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("ignores an old identity check's %s after confirmed logout", async outcome => {
    vi.spyOn(recoveryStorage, "clearUser").mockResolvedValue(undefined);
    const old = pendingIdentity();
    mocks.getCurrentUser.mockReturnValueOnce(old.promise);
    const view = renderAuthenticated();
    let checking!: Promise<void>;
    act(() => { checking = view.auth().refreshAuth(); });
    await act(() => view.auth().logout());
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    await act(async () => {
      if (outcome === "success") old.resolve({ id: 1, username: "admin", role: "admin" });
      else old.reject(new Error("Late outage"));
      await checking;
    });
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("none");
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["success", "failure"])("ignores an old identity check's %s after a newer login", async outcome => {
    const old = pendingIdentity();
    mocks.getCurrentUser.mockReturnValueOnce(old.promise);
    const view = renderAuthenticated();
    let checking!: Promise<void>;
    act(() => { checking = view.auth().refreshAuth(); });
    act(() => view.auth().login({ id: 2, username: "new-admin", role: "admin" }));
    await act(async () => {
      if (outcome === "success") old.resolve(null);
      else old.reject(new Error("Late outage"));
      await checking;
    });
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("new-admin");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("none");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("ignores an older check's %s while a newer identity check is pending", async outcome => {
    const old = pendingIdentity(), latest = pendingIdentity();
    mocks.getCurrentUser.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const view = renderAuthenticated();
    let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = view.auth().refreshAuth(); });
    act(() => { second = view.auth().refreshAuth(); });
    await act(async () => {
      if (outcome === "success") old.resolve(null);
      else old.reject(new Error("Late outage"));
      await first;
    });
    expect(screen.getByTestId("status")).toHaveTextContent("checking");
    expect(screen.getByTestId("user")).toHaveTextContent("admin");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("error-kind")).toHaveTextContent("none");
    await act(async () => { latest.resolve({ id: 2, username: "new-admin", role: "admin" }); await second; });
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("new-admin");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("clears identity only for a matching cross-tab logout notification", async () => {
    const channels: { onmessage: ((event: { data: unknown }) => void) | null; close: () => void }[] = [];
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      close = vi.fn();
      constructor() { channels.push(this); }
    });
    mocks.getCurrentUser.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    await waitFor(() => expect(channels[0]?.onmessage).toBeTypeOf("function"));
    await act(async () => channels[0].onmessage?.({ data: { action: "logout", userId: 2 } }));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    await act(async () => channels[0].onmessage?.({ data: { action: "logout", userId: 1 } }));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
  });

  it("keeps a cross-tab logout anonymous when an earlier identity check returns", async () => {
    const channels: { onmessage: ((event: { data: unknown }) => void) | null; close: () => void }[] = [];
    vi.stubGlobal("BroadcastChannel", class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      close = vi.fn();
      constructor() { channels.push(this); }
    });
    const old = pendingIdentity();
    mocks.getCurrentUser.mockReturnValueOnce(old.promise);
    const view = renderAuthenticated();
    let checking!: Promise<void>;
    act(() => { checking = view.auth().refreshAuth(); });
    act(() => channels[0].onmessage?.({ data: { action: "logout", userId: 1 } }));
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    await act(async () => { old.resolve({ id: 1, username: "admin", role: "admin" }); await checking; });
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("clears an expired session and redirects an admin path only once", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, username: "admin", role: "admin" });
    window.history.replaceState({}, "", "/editor?tab=files");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Invalid or expired session",
      code: "invalid_session",
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    let auth!: ReturnType<typeof useAuth>;
    render(<AuthProvider><AuthProbe onAuth={value => { auth = value; }} /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    const old = pendingIdentity();
    mocks.getCurrentUser.mockReturnValueOnce(old.promise);
    let checking!: Promise<void>;
    act(() => { checking = auth.refreshAuth(); });

    await act(async () => {
      await apiRequest("/admin/posts", { auth: true }).catch(() => undefined);
      await apiRequest("/admin/files", { auth: true }).catch(() => undefined);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login?redirect=%2Feditor%3Ftab%3Dfiles");
    await act(async () => { old.resolve({ id: 1, username: "admin", role: "admin" }); await checking; });
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(mocks.replace).toHaveBeenCalledOnce();
  });
});
