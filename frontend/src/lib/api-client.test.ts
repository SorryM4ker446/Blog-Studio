import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  clearCSRFToken,
  getApiErrorMessage,
  setCSRFToken,
  subscribeSessionExpired,
} from "./api-client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function setCSRFCookie(value: string): void {
  document.cookie = `blog_csrf=${encodeURIComponent(value)}; path=/`;
}

function clearCSRFCookie(): void {
  document.cookie = "blog_csrf=; Max-Age=0; path=/";
}

describe("apiRequest", () => {
  beforeEach(() => {
    clearCSRFToken();
    clearCSRFCookie();
  });

  afterEach(() => {
    clearCSRFCookie();
    vi.unstubAllGlobals();
  });

  it("preserves HTTP error details and Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { error: "Too many attempts", code: "login_rate_limited" },
      { status: 429, headers: { "Retry-After": "17" } },
    )));

    await expect(apiRequest("/login")).rejects.toMatchObject({
      name: "ApiError",
      kind: "http",
      status: 429,
      code: "login_rate_limited",
      retryAfterSeconds: 17,
      message: "Too many attempts",
    });
  });

  it("classifies non-JSON HTTP failures without trying to parse them as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/html" },
    })));

    await expect(apiRequest("/posts")).rejects.toMatchObject({
      kind: "http",
      status: 502,
      message: "Bad Gateway",
    });
  });

  it("classifies an invalid success payload as a parse error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })));

    await expect(apiRequest("/posts")).rejects.toMatchObject({
      kind: "parse",
      status: 200,
      code: "invalid_response",
    });
  });

  it("classifies network and abort failures separately", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/posts")).rejects.toMatchObject({
      kind: "network",
      status: null,
      code: "network_error",
    });
    await expect(apiRequest("/posts")).rejects.toMatchObject({
      kind: "aborted",
      status: null,
      code: "request_aborted",
    });
  });

  it("notifies listeners for protected 401 responses only", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionExpired(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { error: "Invalid or expired session", code: "invalid_session" },
      { status: 401 },
    )));

    await expect(apiRequest("/admin/posts", { auth: true })).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ code: "invalid_session", status: 401 });

    listener.mockClear();
    await expect(apiRequest("/login")).rejects.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not turn an admin-required 403 into a session-expired event", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionExpired(listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(
      { error: "Admin access required", code: "admin_required" },
      { status: 403 },
    )));

    await expect(apiRequest("/admin/posts", { auth: true })).rejects.toMatchObject({
      status: 403,
      code: "admin_required",
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("shares one CSRF initialization across concurrent mutations", async () => {
    let csrfRequests = 0;
    const mutationHeaders: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/csrf")) {
        csrfRequests += 1;
        return jsonResponse({ csrf_token: "shared-token" });
      }
      mutationHeaders.push(new Headers(init?.headers).get("X-CSRF-Token") || "");
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      apiRequest("/admin/posts", { method: "POST", csrf: true }),
      apiRequest("/admin/files", { method: "POST", csrf: true }),
    ]);

    expect(csrfRequests).toBe(1);
    expect(mutationHeaders).toEqual(["shared-token", "shared-token"]);
  });

  it("refreshes CSRF and retries exactly once after invalid_csrf", async () => {
    let csrfRequests = 0;
    let mutationRequests = 0;
    const mutationHeaders: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/csrf")) {
        csrfRequests += 1;
        return jsonResponse({ csrf_token: `token-${csrfRequests}` });
      }

      mutationRequests += 1;
      mutationHeaders.push(new Headers(init?.headers).get("X-CSRF-Token") || "");
      if (mutationRequests === 1) {
        return jsonResponse({ error: "Invalid CSRF token", code: "invalid_csrf" }, { status: 403 });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/admin/posts", { method: "POST", csrf: true })).resolves.toEqual({ ok: true });
    expect(csrfRequests).toBe(2);
    expect(mutationRequests).toBe(2);
    expect(mutationHeaders).toEqual(["token-1", "token-2"]);
  });

  it("shares a refreshed CSRF token across out-of-order invalid responses", async () => {
    setCSRFToken("stale-token");
    setCSRFCookie("stale-token");
    let csrfRequests = 0;
    let staleRequests = 0;
    let releaseSecondInvalid: () => void = () => undefined;
    const waitForFirstRetry = new Promise<void>((resolve) => {
      releaseSecondInvalid = resolve;
    });
    const mutationHeaders: string[] = [];

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/csrf")) {
        csrfRequests += 1;
        setCSRFCookie("fresh-token");
        return jsonResponse({ csrf_token: "fresh-token" });
      }

      const token = new Headers(init?.headers).get("X-CSRF-Token") || "";
      mutationHeaders.push(token);
      if (token === "stale-token") {
        staleRequests += 1;
        if (staleRequests === 2) {
          await waitForFirstRetry;
        }
        return jsonResponse({ error: "Invalid CSRF token", code: "invalid_csrf" }, { status: 403 });
      }

      releaseSecondInvalid();
      return jsonResponse({ ok: true });
    }));

    await expect(Promise.all([
      apiRequest("/admin/posts", { method: "POST", csrf: true }),
      apiRequest("/admin/files", { method: "POST", csrf: true }),
    ])).resolves.toEqual([{ ok: true }, { ok: true }]);

    expect(csrfRequests).toBe(1);
    expect(mutationHeaders).toEqual(["stale-token", "stale-token", "fresh-token", "fresh-token"]);
  });

  it("does not loop when refreshed CSRF is also rejected", async () => {
    let csrfRequests = 0;
    let mutationRequests = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request) => {
      if (String(input).endsWith("/csrf")) {
        csrfRequests += 1;
        return jsonResponse({ csrf_token: `token-${csrfRequests}` });
      }
      mutationRequests += 1;
      return jsonResponse({ error: "Invalid CSRF token", code: "invalid_csrf" }, { status: 403 });
    }));

    await expect(apiRequest("/admin/posts", { method: "POST", csrf: true })).rejects.toMatchObject({
      status: 403,
      code: "invalid_csrf",
    });
    expect(csrfRequests).toBe(2);
    expect(mutationRequests).toBe(2);
  });
});

describe("getApiErrorMessage", () => {
  it("provides a stable network recovery message", () => {
    expect(getApiErrorMessage(new ApiError("low-level failure", { kind: "network" }))).toBe(
      "Unable to reach the server. Check your connection and try again.",
    );
  });

  it("includes the server retry window for rate limits", () => {
    const error = new ApiError("Too many attempts.", {
      kind: "http",
      status: 429,
      code: "login_rate_limited",
      retryAfterSeconds: 17,
    });
    expect(getApiErrorMessage(error)).toBe("Too many attempts. Try again in 17 seconds.");
  });
});
