"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

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
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const storedUser = localStorage.getItem("blog_user");
      if (storedUser) {
        try { return JSON.parse(storedUser); } catch(e) { return null; }
      }
    }
    return null;
  });
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("blog_token");
    }
    return null;
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const router = useRouter();

  // Load auth state and profile on mount
  useEffect(() => {
    // Fetch profile (it's public) for both guests and admins
    fetchProfile();
    setIsLoading(false);
  }, []);

  async function fetchProfile() {
    const { getSettings } = await import("@/lib/api");
    setIsProfileLoading(true);
    try {
      const data = await getSettings();
      setProfile({
        name: data["profile_name"] || "",
        description: data["profile_description"] || "",
        avatar: data["profile_avatar"] || "",
      });
    } catch (e) {
      console.error("Failed to fetch profile:", e);
    } finally {
      setIsProfileLoading(false);
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
    setProfile(null);
    localStorage.removeItem("blog_token");
    localStorage.removeItem("blog_user");
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
