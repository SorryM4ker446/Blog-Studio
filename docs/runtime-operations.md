# Runtime Operations

The Go backend exposes a small operational surface for a single-instance deployment behind a trusted reverse proxy. These endpoints and logs do not replace database backups or external uptime monitoring.

## Health endpoints

- `GET /health/live` reports whether the HTTP process is running. It deliberately does not query PostgreSQL or storage.
- `GET /health/ready` reports whether the instance should receive traffic. It checks the PostgreSQL connection, verifies that the upload directory is writable through an internal `.health` directory ignored by content scans, and returns `503` after shutdown begins.

Both endpoints send `Cache-Control: no-store`. Failure responses use stable, generic error codes and do not expose database errors, filesystem paths, connection strings, or credentials. Detailed causes remain in server logs.

## Request correlation and logs

Every HTTP response includes `X-Request-ID`. A syntactically valid incoming value is preserved so a trusted reverse proxy can establish correlation; malformed or oversized values are replaced with a random server value.

Production logs are JSON records. Request completion records contain only the request ID, method, route template, response status, duration, response size, and resolved client IP. Raw URLs, query strings, request bodies, cookies, authorization headers, and CSRF values are not included. Attributes whose keys indicate passwords, tokens, cookies, secrets, authorization values, CSRF values, or database connection strings are replaced with `[REDACTED]`.

## Trusted proxies

`TRUSTED_PROXIES` is empty by default, which causes Gin to use the directly connected address and ignore forwarded client addresses. When a reverse proxy is deployed, configure only its exact IP addresses or private network CIDRs as a comma-separated list. Never configure `0.0.0.0/0` or `::/0` merely to make client IPs appear in logs, because login throttling also depends on the resolved address.

Examples:

```text
TRUSTED_PROXIES=127.0.0.1
TRUSTED_PROXIES=172.30.0.0/24
```

The Compose deployment assigns Caddy a stable private address and configures the backend to trust that exact address rather than the entire application subnet. If the Compose subnet is changed, update both `APP_NETWORK_SUBNET` and `CADDY_TRUSTED_IP` together. See [`deployment.md`](deployment.md).

## Operational configuration

| Variable | Default | Constraint |
| --- | ---: | --- |
| `DB_MAX_OPEN_CONNECTIONS` | `10` | 1–100 |
| `DB_MAX_IDLE_CONNECTIONS` | `5` | 0–100 and no greater than the open limit |
| `DB_CONNECTION_MAX_LIFETIME` | `30m` | Positive and at most 24 hours |
| `DB_CONNECTION_MAX_IDLE_TIME` | `5m` | Positive and at most 24 hours |
| `HTTP_READ_HEADER_TIMEOUT` | `5s` | Positive and at most 30 minutes |
| `HTTP_READ_TIMEOUT` | `2m` | Positive and at most 30 minutes |
| `HTTP_WRITE_TIMEOUT` | `5m` | Positive and at most 30 minutes |
| `HTTP_IDLE_TIMEOUT` | `2m` | Positive and at most 30 minutes |
| `HTTP_SHUTDOWN_TIMEOUT` | `20s` | Positive and at most 30 minutes |
| `HEALTH_CHECK_TIMEOUT` | `2s` | Positive and at most 30 minutes |

Go duration syntax is used, for example `1500ms`, `20s`, or `5m`. The HTTP read and write limits must remain long enough for the configured maximum upload and download size.

## Shutdown behavior

The backend handles interrupt and termination signals by immediately making readiness fail, stopping new traffic, and waiting up to `HTTP_SHUTDOWN_TIMEOUT` for active requests. If the deadline expires, remaining connections are closed. The database connection pool closes after the HTTP server has stopped.

The API only verifies migration history while opening the database and never changes the schema. Run `go run ./cmd/migrate up` before starting a backend release. Versioning, advisory locking, matched backups, and isolated restore drills are documented in [`backup-restore.md`](backup-restore.md).

In the production Compose topology, Caddy exposes both health routes without exposing the backend container port. Compose uses PostgreSQL health, successful migration completion, backend readiness, and frontend health to order startup. Container lifecycle and rollback procedures are documented in [`deployment.md`](deployment.md).
