"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, logoutUser, normalizeFileViewUrl } from "@/lib/api";
import { ApiError, clearCSRFToken, isApiError, subscribeSessionExpired } from "@/lib/api-client";

interface User {
  id: number;
  username: string;
  role: string;
}

interface Profile {
  name: string;
  description: string;
  avatar: string;
  tag: string;
}

export type AuthStatus = "checking" | "authenticated" | "anonymous" | "unavailable";

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  login: (user: User) => void;
  logout: () => Promise<void>;
  completeLogout: () => void;
  refreshAuth: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  isLoading: boolean;
  isProfileLoading: boolean;
  authStatus: AuthStatus;
  authError: ApiError | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authError, setAuthError] = useState<ApiError | null>(null);
  const router = useRouter();
  const isMountedRef = useRef(true);
  const profileRequestIdRef = useRef(0);
  const sessionExpiryHandledRef = useRef(false);

  async function refreshAuth() {
    setIsLoading(true);
    setAuthStatus("checking");
    setAuthError(null);
    try {
      const currentUser = await getCurrentUser();
      if (isMountedRef.current) {
        setUser(currentUser);
        setAuthStatus(currentUser ? "authenticated" : "anonymous");
        sessionExpiryHandledRef.current = false;
      }
    } catch (error) {
      if (isMountedRef.current) {
        const authCheckError = isApiError(error)
          ? error
          : new ApiError("Unable to verify the current session", {
              kind: "network",
              code: "auth_check_failed",
              cause: error,
            });
        setUser(null);
        setAuthStatus("unavailable");
        setAuthError(authCheckError);
      }
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }

  // Load auth state and the public profile on mount.
  useEffect(() => {
    isMountedRef.current = true;
    void fetchProfile();
    localStorage.removeItem("blog_token");
    localStorage.removeItem("blog_user");
    void refreshAuth();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return subscribeSessionExpired(() => {
      if (sessionExpiryHandledRef.current) {
        return;
      }
      sessionExpiryHandledRef.current = true;
      setUser(null);
      setIsLoading(false);
      setAuthStatus("anonymous");
      setAuthError(null);

      if (typeof window === "undefined") {
        return;
      }
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const isAdminPath = window.location.pathname === "/editor"
        || window.location.pathname.startsWith("/editor/")
        || window.location.pathname === "/settings"
        || window.location.pathname.startsWith("/settings/");
      if (isAdminPath) {
        router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`);
      }
    });
  }, [router]);

  async function fetchProfile() {
    const requestId = ++profileRequestIdRef.current;
    const { getSettings } = await import("@/lib/api");
    if (isMountedRef.current) {
      setIsProfileLoading(true);
    }

    try {
      const data = await getSettings();
      if (!isMountedRef.current || requestId !== profileRequestIdRef.current) {
        return;
      }

      setProfile({
        name: data["profile_name"] || "",
        description: data["profile_description"] || "",
        avatar: normalizeFileViewUrl(data["profile_avatar"] || ""),
        tag: data["profile_tag"] || "",
      });
    } catch (e) {
      if (isMountedRef.current) {
        console.error("Failed to fetch profile:", e);
      }
    } finally {
      if (isMountedRef.current && requestId === profileRequestIdRef.current) {
        setIsProfileLoading(false);
      }
    }
  }

  const login = (newUser: User) => {
    sessionExpiryHandledRef.current = false;
    setUser(newUser);
    setIsLoading(false);
    setAuthStatus("authenticated");
    setAuthError(null);
    fetchProfile(); // Fetch profile immediately after login
  };

  const completeLogout = () => {
    sessionExpiryHandledRef.current = true;
    clearCSRFToken();
    setUser(null);
    setIsLoading(false);
    setAuthStatus("anonymous");
    setAuthError(null);
    router.replace("/");
  };

  const logout = async () => {
    await logoutUser();
    completeLogout();
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      login, 
      logout, 
      completeLogout,
      refreshAuth,
      refreshProfile: fetchProfile,
      isLoading,
      isProfileLoading,
      authStatus,
      authError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
