"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, normalizeFileViewUrl } from "@/lib/api";

interface User {
  id: number;
  username: string;
  role: string;
}

interface Profile {
  name: string;
  description: string;
  avatar: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  profile: Profile | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  isLoading: boolean;
  isProfileLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const router = useRouter();
  const isMountedRef = useRef(true);
  const profileRequestIdRef = useRef(0);

  const clearStoredAuth = () => {
    localStorage.removeItem("blog_token");
    localStorage.removeItem("blog_user");
  };

  // Load auth state and profile on mount
  useEffect(() => {
    isMountedRef.current = true;
    const initializeAuth = async () => {
      // Fetch profile (it's public) for both guests and admins
      void fetchProfile();

      const storedToken = typeof window !== "undefined" ? localStorage.getItem("blog_token") : null;
      if (storedToken) {
        const currentUser = await getCurrentUser();
        if (isMountedRef.current) {
          if (currentUser) {
            setUser(currentUser);
            setToken(storedToken);
            localStorage.setItem("blog_user", JSON.stringify(currentUser));
          } else {
            setUser(null);
            setToken(null);
            clearStoredAuth();
          }
        }
      } else if (isMountedRef.current) {
        setUser(null);
        setToken(null);
      }

      if (isMountedRef.current) {
        setIsLoading(false);
      }
    };

    void initializeAuth();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("blog_token", newToken);
    localStorage.setItem("blog_user", JSON.stringify(newUser));
    fetchProfile(); // Fetch profile immediately after login
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    clearStoredAuth();
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      token, 
      profile, 
      login, 
      logout, 
      refreshProfile: fetchProfile,
      isLoading,
      isProfileLoading
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
