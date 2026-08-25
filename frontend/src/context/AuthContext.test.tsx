import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api-client";
import { AuthProvider, useAuth } from "./AuthContext";
import TopBar from "@/components/TopBar";

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

function AuthProbe() {
  const { user, profile, authStatus, authError, isLoading, isProfileLoading } = useAuth();
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
        <TopBar />
      </AuthProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Ada");
    expect(screen.getByTestId("profile-loading")).toHaveTextContent("false");
    expect(screen.getByRole("img", { name: "avatar" })).toHaveAttribute(
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

    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    await act(async () => {
      await apiRequest("/admin/posts", { auth: true }).catch(() => undefined);
      await apiRequest("/admin/files", { auth: true }).catch(() => undefined);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login?redirect=%2Feditor%3Ftab%3Dfiles");
  });
});
