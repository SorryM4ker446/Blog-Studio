const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080/api";

export type ApiErrorKind = "http" | "network" | "parse" | "aborted";

export interface ApiErrorOptions {
  kind: ApiErrorKind;
  status?: number | null;
  code?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ApiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getApiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!isApiError(error)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  if (error.kind === "aborted") return "The request was cancelled.";
  if (error.kind === "network") return "Unable to reach the server. Check your connection and try again.";
  if (error.status === 401 && error.code !== "invalid_credentials") {
    return "Your session has expired. Sign in again to continue.";
  }
  if (error.status === 403 && error.code === "admin_required") {
    return "You do not have permission to perform this action.";
  }
  if (error.status === 429) {
    const retry = error.retryAfterSeconds === undefined ? "Please try again later." : `Try again in ${error.retryAfterSeconds} seconds.`;
    return `${error.message || "Too many requests."} ${retry}`;
  }
  return error.message || fallback;
}

type SessionExpiredListener = (error: ApiError) => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function subscribeSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired(error: ApiError): void {
  for (const listener of sessionExpiredListeners) {
    try {
      listener(error);
    } catch {
      // A UI listener must not replace the original API failure.
    }
  }
}

let csrfToken = "";
let csrfRequestPromise: Promise<string> | null = null;
const CSRF_COOKIE_NAME = "blog_csrf";

function readCSRFTokenCookie(): string {
  if (typeof document === "undefined") {
    return "";
  }
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) {
    return "";
  }
  const value = entry.slice(prefix.length);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function syncCSRFTokenFromCookie(): string {
  const cookieToken = readCSRFTokenCookie();
  if (cookieToken && cookieToken !== csrfToken) {
    csrfToken = cookieToken;
  }
  return cookieToken;
}

export function clearCSRFToken(): void {
  csrfToken = "";
}

export function setCSRFToken(token: string): void {
  csrfToken = token;
}

interface ErrorPayload {
  error?: unknown;
  code?: unknown;
}

function isJSONContentType(value: string): boolean {
  return /(?:^|[\/+])json(?:;|$)/i.test(value);
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  auth?: boolean;
  csrf?: boolean;
  forceCSRFRefresh?: boolean;
  responseType?: "json" | "text" | "void";
}

function resolveApiURL(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }

  const retryDate = Date.parse(value);
  if (Number.isNaN(retryDate)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
}

async function readHTTPError(response: Response): Promise<ApiError> {
  let payload: ErrorPayload | null = null;
  const contentType = response.headers.get("content-type") || "";

  if (isJSONContentType(contentType)) {
    try {
      payload = await response.json() as ErrorPayload;
    } catch {
      payload = null;
    }
  }

  const message = typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : response.statusText || `Request failed with status ${response.status}`;
  const code = typeof payload?.code === "string" ? payload.code : undefined;

  return new ApiError(message, {
    kind: "http",
    status: response.status,
    code,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
  });
}

function classifyFetchError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return new ApiError("Request was cancelled", {
      kind: "aborted",
      code: "request_aborted",
      cause: error,
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ApiError("Request was cancelled", {
      kind: "aborted",
      code: "request_aborted",
      cause: error,
    });
  }
  return new ApiError("Unable to reach the server", {
    kind: "network",
    code: "network_error",
    cause: error,
  });
}

async function parseSuccessResponse<T>(response: Response, responseType: ApiRequestOptions["responseType"]): Promise<T> {
  if (responseType === "void" || response.status === 204) {
    return undefined as T;
  }
  if (responseType === "text") {
    return await response.text() as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!isJSONContentType(contentType)) {
    throw new ApiError("Server returned an invalid response", {
      kind: "parse",
      status: response.status,
      code: "invalid_response",
    });
  }

  try {
    return await response.json() as T;
  } catch (error) {
    throw new ApiError("Server returned invalid JSON", {
      kind: "parse",
      status: response.status,
      code: "invalid_json_response",
      cause: error,
    });
  }
}

async function performRequest<T>(path: string, options: ApiRequestOptions, allowCSRFRefresh: boolean): Promise<T> {
  const {
    auth = false,
    csrf = false,
    forceCSRFRefresh = false,
    responseType = "json",
    headers: providedHeaders,
    ...requestInit
  } = options;

  const headers = new Headers(providedHeaders);
  let csrfTokenForRequest = "";
  if (csrf) {
    csrfTokenForRequest = await ensureCSRFToken(forceCSRFRefresh);
    headers.set("X-CSRF-Token", csrfTokenForRequest);
  }

  let response: Response;
  try {
    response = await fetch(resolveApiURL(path), {
      ...requestInit,
      credentials: requestInit.credentials ?? "include",
      headers,
    });
  } catch (error) {
    throw classifyFetchError(error);
  }

  if (!response.ok) {
    const apiError = await readHTTPError(response);
    if (csrf && allowCSRFRefresh && apiError.status === 403 && apiError.code === "invalid_csrf") {
      await refreshCSRFTokenAfterRejection(csrfTokenForRequest);
      return performRequest<T>(path, { ...options, forceCSRFRefresh: false }, false);
    }
    if (auth && apiError.status === 401) {
      clearCSRFToken();
      notifySessionExpired(apiError);
    }
    throw apiError;
  }

  return parseSuccessResponse<T>(response, responseType);
}

async function requestCSRFToken(): Promise<string> {
  const data = await performRequest<{ csrf_token?: unknown }>("/csrf", {
    method: "GET",
    cache: "no-store",
  }, false);
  if (typeof data.csrf_token !== "string" || !data.csrf_token) {
    throw new ApiError("Server returned an invalid CSRF token", {
      kind: "parse",
      status: 200,
      code: "invalid_csrf_response",
    });
  }
  csrfToken = data.csrf_token;
  return csrfToken;
}

export async function ensureCSRFToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cookieToken = syncCSRFTokenFromCookie();
    if (cookieToken) {
      return cookieToken;
    }
  }
  if (forceRefresh && !csrfRequestPromise) {
    clearCSRFToken();
  }
  if (csrfToken && !forceRefresh) {
    return csrfToken;
  }
  if (!csrfRequestPromise) {
    csrfRequestPromise = requestCSRFToken().finally(() => {
      csrfRequestPromise = null;
    });
  }
  return csrfRequestPromise;
}

async function refreshCSRFTokenAfterRejection(rejectedToken: string): Promise<string> {
  const cookieToken = syncCSRFTokenFromCookie();
  if (cookieToken && cookieToken !== rejectedToken) {
    return cookieToken;
  }
  if (csrfToken && csrfToken !== rejectedToken) {
    return csrfToken;
  }

  if (csrfRequestPromise) {
    const pendingToken = await csrfRequestPromise;
    const latestCookieToken = syncCSRFTokenFromCookie();
    if (latestCookieToken && latestCookieToken !== rejectedToken) {
      return latestCookieToken;
    }
    if (pendingToken !== rejectedToken) {
      return pendingToken;
    }
  }

  if (csrfToken === rejectedToken) {
    clearCSRFToken();
  }
  return ensureCSRFToken(true);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return performRequest<T>(path, options, true);
}

export { API_BASE };
