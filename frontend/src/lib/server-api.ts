const DEFAULT_API_BASE = "http://localhost:8080/api";
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;

export type ServerJSONResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number | null };

export function getServerAPIBase(): string {
  const configuredBase = process.env.API_INTERNAL_BASE_URL?.trim()
    || process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
    || DEFAULT_API_BASE;

  try {
    return new URL(configuredBase).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function getBrowserAPIBase(): string {
  const configuredBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE;
  if (/^\/(?!\/)/.test(configuredBase) && !/[?#]/.test(configuredBase)) {
    return configuredBase.replace(/\/$/, "");
  }
  try {
    const parsed = new URL(configuredBase);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_API_BASE;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_API_BASE;
  }
}

export async function requestServerJSON<T = unknown>(
  path: string,
  options: {
    cookieHeader?: string;
    timeoutMs?: number;
  } = {},
): Promise<ServerJSONResult<T>> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.cookieHeader) {
    headers.set("Cookie", options.cookieHeader);
  }

  try {
    const response = await fetch(`${getServerAPIBase()}${path}`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    return { ok: true, data: await response.json() as T };
  } catch {
    return { ok: false, status: null };
  }
}
