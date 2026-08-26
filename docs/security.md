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
