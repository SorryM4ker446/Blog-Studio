# Blog Studio

Blog Studio is a full-stack blog and content management application. The repository contains a Next.js frontend, a Go API, PostgreSQL migrations, file storage, and deployment tooling.

## Features

- Public article and file browsing with category filters, search, pagination, and responsive navigation.
- An authenticated editor for posts and cloud-drive files.
- Version-checked saves, explicit publication actions, recovery copies, and unsaved-change protection.
- Server-rendered initial pages with stable refresh, navigation, and layout behavior.
- PostgreSQL-backed search with exact result counts and bounded pagination.
- Health endpoints, structured operational checks, Prometheus metrics, backup and restore tools, and CI validation.

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/` | Next.js application, React components, unit tests, and Playwright tests |
| `backend/` | Go API, migrations, seed command, and backup/restore tools |
| `deploy/` | Docker Compose configuration, Caddy configuration, secrets guidance, and database initialization |
| `docs/` | Development, testing, security, editor, deployment, and operations documentation |
| `tools/` | Quality gates, coverage checks, and supporting scripts |
| `compose.yaml` | Production deployment topology |

## Requirements

Native development uses:

- Node.js 22 with the locked dependencies in `frontend/package-lock.json`.
- Go 1.26.8.
- PostgreSQL 18.
- The `pg_trgm` extension installed in the `public` schema for the indexed-search migration.

Docker Compose deployment has additional Linux host and Docker requirements. See [`docs/deployment.md`](docs/deployment.md) before deploying a site.

## Native development

### Start PostgreSQL

Create an empty development database before running the migration command:

```sql
CREATE DATABASE blog_db;
```

The migration role must be able to use the `public` schema and install or access `pg_trgm`. The deployment documentation explains the extension prerequisite and its permissions.

### Start the backend

Open a PowerShell window in `backend/` and set local-only values. Use a randomly generated JWT secret of at least 32 bytes; never commit real credentials.

```powershell
$env:DB_DSN = "host=localhost user=postgres password=your_password dbname=blog_db port=5432 sslmode=disable TimeZone=Asia/Shanghai"
$env:JWT_SECRET = "replace_with_at_least_32_random_characters"
$env:SERVER_ADDRESS = ":8080"
$env:APP_ENV = "development"
$env:ALLOWED_ORIGINS = "http://localhost:3000"
$env:COOKIE_SECURE = "false"
$env:TRUSTED_PROXIES = ""
$env:UPLOAD_DIR = "uploads"
$env:MAX_UPLOAD_BYTES = "10485760"

go run ./cmd/migrate up
go run ./cmd/server
```

Run the migration command explicitly whenever a new database migration is required. The API checks the migration version at startup and does not modify the schema automatically.

To create the first administrator in an empty database, set a strong password of at least 12 characters and run the seed command once:

```powershell
$env:ADMIN_USER = "admin"
$env:ADMIN_PASS = "replace_with_a_strong_password_at_least_12_characters"
go run ./cmd/seed
```

The seed command does not replace an existing account. Passwords are limited to 12–128 characters and 72 UTF-8 bytes, cannot be common weak passwords, and cannot contain the username.

### Start the frontend

Open a second terminal in `frontend/`:

```powershell
npm ci
npm run dev
```

Open <http://localhost:3000>. Browser requests use `NEXT_PUBLIC_API_BASE_URL`; server-rendered requests use `API_INTERNAL_BASE_URL`. For native development, both normally point to `http://localhost:8080/api`:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8080/api"
$env:API_INTERNAL_BASE_URL = "http://localhost:8080/api"
```

In a container deployment, `API_INTERNAL_BASE_URL` must use the private backend service address and must never contain credentials. The Compose configuration provides the container value automatically.

## Verification

Run frontend checks from `frontend/`:

```powershell
npm run lint
npm run test:unit
npm run test:coverage
npm run build
npm audit
npm run test:e2e
```

Run backend checks from `backend/` when backend code or backend test tooling changes:

```powershell
go test ./...
go test -race ./...
go vet ./...
go build ./...
```

The backend integration suites require PostgreSQL and use a disposable test database. Do not run Docker Compose as a substitute for the native checks above during local development. Container topology and deployment checks run in GitHub Actions.

See [`docs/testing.md`](docs/testing.md) for test boundaries, database setup, browser coverage, failure artifacts, and the current quality gates. Coverage reports are generated locally and are not a substitute for the CI result.

## Configuration and security

`backend/.env.example` lists the supported backend variables and safe placeholders. Container deployments use the non-secret template in `deploy/.env.example` and secret files described in [`deploy/secrets/README.md`](deploy/secrets/README.md). Do not place passwords, JWT values, database DSNs, or restored data in committed configuration.

Sessions use site-level HttpOnly cookies and are not stored in `localStorage`. Sign-out and password changes invalidate old sessions. Theme and sidebar preferences use cookies so the server-rendered page and the browser start with the same values. Runtime health checks, public caching, rate limits, metrics, request logging, and shutdown behavior are documented in [`docs/runtime-operations.md`](docs/runtime-operations.md).

Read the following documents for behavior that is easy to miss during development:

- [`docs/editor.md`](docs/editor.md) — editor behavior, save and publish compatibility, recovery, and leave protection.
- [`docs/accessibility.md`](docs/accessibility.md) — keyboard behavior, responsive navigation, reduced motion, and image loading.
- [`docs/search-contract.md`](docs/search-contract.md) — list, detail, search, pagination, and URL contracts.
- [`docs/file-storage.md`](docs/file-storage.md) — upload, storage, preview, and download rules.
- [`docs/security.md`](docs/security.md) — production security configuration.
- [`docs/backup-restore.md`](docs/backup-restore.md) — matched database and upload backups and isolated restore verification.

## Production deployment

The supported deployment baseline is one Linux host running Docker Compose, with Caddy as the public HTTPS entry point, private Next.js and Go services, PostgreSQL, and persistent upload and certificate volumes. The deployment workflow runs migrations before the API, uses secret files for sensitive values, and exposes only Caddy to the public network.

Follow [`docs/deployment.md`](docs/deployment.md) for host prerequisites, secret preparation, the `pg_trgm` prerequisite, first deployment, upgrades, rollback, and troubleshooting. The committed CI workflow validates the container topology; a successful native run does not prove that the remote container job or a production deployment has passed.

## Styling

Global styles are in `frontend/src/app/globals.css`. The `--bg-sidebar`, `--nav-active`, and `--accent-*` variables control the main sidebar and accent colors. Preserve the existing keyboard, reduced-motion, responsive, and server-rendering behavior when changing styles.
