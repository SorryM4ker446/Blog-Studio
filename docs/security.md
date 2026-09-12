# Authentication and Security

## Browser session

The backend signs a 24-hour JWT and stores it only in the site-scoped `blog_session` HttpOnly Cookie. Frontend JavaScript and local storage never receive the JWT. The Next.js server forwards the incoming Cookie to the backend only when resolving the initial identity for server rendering, which avoids replacing the guest shell after hydration. Each authenticated API request still checks the user's current role and `session_version` in PostgreSQL.

Older `/api`-scoped session Cookies are expired during login, logout, and identity restoration. This compatibility cleanup prevents duplicate same-name Cookies while existing sessions move to the site-scoped path required by server rendering.

Logging out or changing the password increments `session_version`, immediately invalidating copies of the previous Cookie. Password changes require signing in again.

## CSRF protection

Before login or another state-changing request, the frontend obtains a CSRF token from `GET /api/csrf`. `POST`, `PUT`, and `DELETE` requests must send the matching token in the `X-CSRF-Token` header. The server compares the header with the CSRF Cookie using a constant-time comparison.

## Login and password controls

- Five failed login attempts within 15 minutes block further attempts from the same IP address. The API returns `429 Too Many Requests` and `Retry-After`.
- Passwords must contain 12–128 Unicode characters, fit within bcrypt's 72-byte input limit, must not be on the built-in common-password list, and must not contain the username.
- Login failures use a single error message and perform a password-hash comparison even when the username does not exist.

Public search uses a separate token bucket with a default burst of 30 and a refill rate of 120 requests per minute. It returns `429`, `Retry-After`, and `search_rate_limited` without affecting administrator search. Both limiters are process-local. A future multi-instance deployment should replace them with a shared store such as Redis so all instances enforce one limit.

Public browser `fetch` calls omit credentials, and public handlers do not read session identity. Administrator, authentication, mutation, error, health, and metrics responses use `Cache-Control: no-store`; successful public representations opt into their documented cache policy explicitly.

`GET /api/admin/posts/:id` checks the current session and administrator role before returning a full draft or published article. Anonymous requests return 401, non-administrators return 403, and all responses remain no-store. Public detail continues to return 404 for drafts even with an administrator Cookie. Lists and search responses carry summary fields only; removing bodies does not widen public search access to drafts or system files. Editor loads detail through the authenticated request client, preserving the existing session-expiry flow.

## Deployment configuration

Development defaults allow `http://localhost:3000` and `http://127.0.0.1:3000`, with non-secure Cookies for local HTTP. Production requires an explicit HTTPS origin and secure Cookies:

```text
APP_ENV=production
ALLOWED_ORIGINS=https://blog.example.com
COOKIE_SECURE=true
```

The frontend server also needs an internal API origin for its initial server-rendered profile and identity requests:

```text
API_INTERNAL_BASE_URL=http://backend:8080/api
```

This value is a network location, not a credential. It should use the private container or host network when available. `NEXT_PUBLIC_API_BASE_URL` remains the browser-visible API origin.

`ALLOWED_ORIGINS` accepts a comma-separated list of exact origins. Wildcards are rejected. Requests without an `Origin` header remain available to trusted command-line clients, while browser requests from an unlisted origin receive `403 Forbidden`.

The Compose deployment mounts PostgreSQL, JWT, and initial administrator secrets as files under `/run/secrets`. Backend configuration supports `DB_PASSWORD_FILE`, `JWT_SECRET_FILE`, and `ADMIN_PASS_FILE` for this purpose and rejects simultaneous direct and file forms. The browser-facing frontend image contains no secret; `NEXT_PUBLIC_API_BASE_URL` is intentionally compiled as the public same-origin `/api` path.

The backend does not trust forwarded client addresses by default. A production reverse proxy must be listed explicitly in `TRUSTED_PROXIES`; broad public network ranges must not be trusted. This boundary affects request attribution and both rate limiters.

The Prometheus endpoint is intentionally unauthenticated on the backend's private listener. Caddy does not route it and Compose does not publish the backend port. Do not expose that listener to an untrusted network. See [`runtime-operations.md`](runtime-operations.md) for health endpoints, request IDs, cache policy, metrics, structured logging, and operational timeouts.

## Article write conflicts

Article saves, publication and withdrawal require administrator authentication, CSRF protection and a matching article version. Stale writes return `409 post_version_conflict`; clients cannot silently replace the current server version. Article editor requests handle session expiry locally so entered text remains available while the user signs in in another tab. Server permission and session checks remain mandatory; this exception does not authorize expired sessions. See [editor.md](editor.md) for conflict recovery and the current limits of unsaved-input protection.

## Frontend security maintenance

The dependency lockfile uses Next.js and eslint-config-next 16.3.4 with updated sharp and js-yaml dependencies. These updates address the security advisories reported by the September 9, 2026 audit. Run `npm ci` after updating the checkout, rebuild the frontend, and rerun `npm audit`; an earlier clean audit is not evidence for a later dependency state.

## Local article recovery privacy

Unsaved editor fields are stored unencrypted in origin-local IndexedDB for up to seven days, within a 20-copy/4-MiB application limit. The application offers copies only to the matching authenticated user, but browser-profile access and same-origin script execution can read them. Copies never contain authentication credentials and are not uploaded automatically. Confirmed logout clears that user's records and invalidates old writers; session expiry preserves work for explicit recovery. Browser denial can prevent cleanup as well as saving, in which case the user is warned to clear site data. See [editor.md](editor.md) for retention, multiple-tab ownership, conflict protection and browser lifecycle limits.
