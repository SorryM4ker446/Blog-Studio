import type {
  AuthUser,
  InitialAppShellState,
  PublicProfile,
  SidebarCategory,
} from "@/lib/app-shell-state";
import { rebaseFileViewURLs } from "@/lib/file-url";
import { getBrowserAPIBase, requestServerJSON } from "@/lib/server-api";

function readStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return null;
    }
    result[key] = entry;
  }
  return result;
}

function readUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "number"
    || !Number.isSafeInteger(candidate.id)
    || candidate.id <= 0
    || typeof candidate.username !== "string"
    || typeof candidate.role !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    username: candidate.username,
    role: candidate.role,
  };
}

function readProfile(value: unknown): PublicProfile | null {
  const settings = readStringRecord(value);
  if (!settings) {
    return null;
  }
  return {
    name: settings.profile_name || "",
    description: settings.profile_description || "",
    avatar: rebaseFileViewURLs(settings.profile_avatar || "", getBrowserAPIBase()),
    tag: settings.profile_tag || "",
  };
}

function readSidebarCategories(value: unknown): SidebarCategory[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const categories: SidebarCategory[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.id !== "number"
      || !Number.isSafeInteger(candidate.id)
      || candidate.id <= 0
      || typeof candidate.name !== "string"
    ) {
      return null;
    }
    categories.push({
      id: candidate.id,
      name: candidate.name,
      post_count: typeof candidate.post_count === "number" ? candidate.post_count : 0,
    });
  }
  return categories;
}

export async function loadInitialAppShellState(cookieHeader: string): Promise<InitialAppShellState> {
  const [profileResult, authResult, categoryResult] = await Promise.all([
    requestServerJSON("/settings"),
    requestServerJSON("/admin/me", { cookieHeader }),
    requestServerJSON("/categories"),
  ]);

  const profile = profileResult.ok ? readProfile(profileResult.data) : null;
  const user = authResult.ok ? readUser(authResult.data) : null;
  const categories = categoryResult.ok ? readSidebarCategories(categoryResult.data) : null;
  const authResponseStatus = "status" in authResult ? authResult.status : null;
  const hasSessionCookie = /(?:^|;\s*)blog_session=/.test(cookieHeader);
  const hasLegacySessionHint = !hasSessionCookie && /(?:^|;\s*)blog_csrf=/.test(cookieHeader);

  return {
    user,
    profile,
    profileResolved: profile !== null,
    authStatus: user
      ? "authenticated"
      : authResult.ok || authResponseStatus === 401
        ? "anonymous"
        : "unavailable",
    authNeedsClientCheck: hasLegacySessionHint || (!authResult.ok && authResponseStatus !== 401),
    categories: (categories || [])
      .filter((category) => category.post_count > 0)
      .sort((a, b) => b.post_count - a.post_count),
    categoriesResolved: categories !== null,
  };
}
