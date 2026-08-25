export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export interface PublicProfile {
  name: string;
  description: string;
  avatar: string;
  tag: string;
}

export interface SidebarCategory {
  id: number;
  name: string;
  post_count: number;
}

export type AuthStatus = "checking" | "authenticated" | "anonymous" | "unavailable";

export interface InitialAppShellState {
  user: AuthUser | null;
  profile: PublicProfile | null;
  profileResolved: boolean;
  authStatus: Exclude<AuthStatus, "checking">;
  authNeedsClientCheck: boolean;
  categories: SidebarCategory[];
  categoriesResolved: boolean;
}
