import { afterEach, describe, expect, it, vi } from "vitest";

import { loadInitialAppShellState } from "./server-app-shell";

describe("loadInitialAppShellState", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads the public profile and authenticated identity for the first render", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/settings")) {
        return new Response(JSON.stringify({
          profile_name: "Ada",
          profile_description: "Engineer",
          profile_avatar: "http://backend.test/api/files/7/download",
          profile_tag: "Admin",
        }), { status: 200 });
      }
      if (url.endsWith("/categories")) {
        return new Response(JSON.stringify([
          { id: 2, name: "TypeScript", post_count: 3 },
          { id: 1, name: "Empty", post_count: 0 },
        ]), { status: 200 });
      }
      expect(new Headers(init?.headers).get("Cookie")).toBe("blog_session=signed");
      return new Response(JSON.stringify({ id: 1, username: "ada", role: "admin" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadInitialAppShellState("blog_session=signed")).resolves.toEqual({
      user: { id: 1, username: "ada", role: "admin" },
      profile: {
        name: "Ada",
        description: "Engineer",
        avatar: "http://backend.test/api/files/7/view",
        tag: "Admin",
      },
      profileResolved: true,
      authStatus: "authenticated",
      authNeedsClientCheck: false,
      categories: [{ id: 2, name: "TypeScript", post_count: 3 }],
      categoriesResolved: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("distinguishes an anonymous visitor from unavailable shell data", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/admin/me")) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    await expect(loadInitialAppShellState("")).resolves.toMatchObject({
      user: null,
      profileResolved: true,
      authStatus: "anonymous",
      authNeedsClientCheck: false,
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadInitialAppShellState("")).resolves.toEqual({
      user: null,
      profile: null,
      profileResolved: false,
      authStatus: "unavailable",
      authNeedsClientCheck: true,
      categories: [],
      categoriesResolved: false,
    });
  });

  it("requests one client-side compatibility check when only the legacy session hint is visible", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://backend.test/api");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/admin/me")) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    await expect(loadInitialAppShellState("blog_csrf=hint")).resolves.toMatchObject({
      authStatus: "anonymous",
      authNeedsClientCheck: true,
    });
  });
});
