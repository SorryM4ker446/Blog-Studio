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

The login limiter is process-local. A future multi-instance deployment should replace it with a shared store such as Redis so all instances enforce one limit.

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

The backend does not trust forwarded client addresses by default. A production reverse proxy must be listed explicitly in `TRUSTED_PROXIES`; broad public network ranges must not be trusted. This boundary affects both request attribution and login throttling. See [`runtime-operations.md`](runtime-operations.md) for health endpoints, request IDs, structured logging, and operational timeouts.
