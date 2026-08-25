# Authentication and Security

## Browser session

The backend signs a 24-hour JWT and stores it only in the `blog_session` HttpOnly Cookie. Frontend JavaScript and local storage never receive the JWT. Each authenticated request also checks the user's current role and `session_version` in PostgreSQL.

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

`ALLOWED_ORIGINS` accepts a comma-separated list of exact origins. Wildcards are rejected. Requests without an `Origin` header remain available to trusted command-line clients, while browser requests from an unlisted origin receive `403 Forbidden`.

The backend does not trust forwarded client addresses by default. A production reverse proxy must be listed explicitly in `TRUSTED_PROXIES`; broad public network ranges must not be trusted. This boundary affects both request attribution and login throttling. See [`runtime-operations.md`](runtime-operations.md) for health endpoints, request IDs, structured logging, and operational timeouts.
