# Docker Compose Deployment

Blog Studio's deployment baseline targets one Linux host running Docker Compose. Caddy is the only public service; it terminates HTTPS and routes same-origin requests to one Next.js container and one Go API container. PostgreSQL and uploaded content remain on named volumes.

This deployment layout does not replace native development. The existing `npm run dev`, `go run ./cmd/migrate up`, and `go run ./cmd/server` commands continue to use the local environment examples and host ports.

## Topology

| Service | Publicly exposed | Purpose |
| --- | --- | --- |
| `caddy` | TCP 80/443 and UDP 443 | Automatic HTTPS and same-origin routing |
| `frontend` | No | Next.js standalone server on the private Compose network |
| `backend` | No | Go API and health endpoints on the private Compose network |
| `migrate` | No; exits after success | Applies versioned migrations before the API starts |
| `postgres` | No | PostgreSQL 18 with persistent database storage |
| `seed` | Tools profile only | Creates the first administrator once |
| `maintenance` | Tools profile only | Runs verified backup and restore binaries with PostgreSQL 18 client tools |

Browser requests use `/api`, so session and CSRF Cookies stay on the public site origin. Server-rendered Next.js requests use `API_INTERNAL_BASE_URL=http://backend:8080/api`; this address is private and is never bundled for the browser. Caddy also routes `/health/live` and `/health/ready` to the backend for external monitoring.

The backend also exposes Prometheus data at `/internal/metrics` only on its private container listener. Caddy does not route this path. The baseline does not add a Prometheus container; [`runtime-operations.md`](runtime-operations.md) documents how to connect separately managed monitoring and use the committed example rules.

## Host prerequisites

- A Linux host with the Docker Engine and Docker Compose plugin 2.20 or newer.
- A public DNS `A` or `AAAA` record pointing to the host.
- Inbound TCP 80 and 443, plus UDP 443 if HTTP/3 is desired.
- Enough durable disk space for PostgreSQL, uploads, Caddy certificate state, container images, and retained backups.
- An off-host, encrypted destination for copies of verified backup bundles.

Caddy obtains and renews public certificates automatically when `SITE_ADDRESS` is a public hostname and ports 80 and 443 are reachable. Its `caddy_data` and `caddy_config` volumes must remain persistent.

## Prepare configuration and secrets

Copy the non-secret template and edit both public-address values so they identify the same site:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

For example, `SITE_ADDRESS=blog.example.com` pairs with `SITE_ORIGIN=https://blog.example.com`. Set `APP_IMAGE_TAG` to an immutable release identifier such as a Git commit SHA. The default network keeps Caddy's fixed trusted address outside the dynamic container pool. If the subnet conflicts with a host network, change `APP_NETWORK_SUBNET`, choose `APP_NETWORK_IP_RANGE` inside that subnet, and choose `CADDY_TRUSTED_IP` inside the subnet but outside the dynamic range.

Create the three secret files as described in [`deploy/secrets/README.md`](../deploy/secrets/README.md). Compose mounts a secret only into services that declare it. The backend accepts either the existing direct variables or their `_FILE` alternatives; when both forms of the same value are set, startup fails instead of choosing one silently.

Prepare the host-visible backup directory for the non-root maintenance container:

```bash
mkdir -p deploy/backups
sudo chown 10001:10001 deploy/backups
chmod 700 deploy/backups
```

Do not put passwords, JWT values, database DSNs, or restored data in `deploy/.env`. The committed file contains only non-secret settings and secret file paths.

## PostgreSQL search prerequisite

Migration `2026090601` requires `pg_trgm` installed in schema `public`, plus `USAGE` on that schema for the migration role. The runtime and migration commands do not install extensions or grant themselves privileges. An operator runs this in the intended application database before migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
```

Check `pg_extension`/`pg_namespace` to confirm the existing extension is actually in `public`; `IF NOT EXISTS` does not move an extension from another schema. On deployments with separate roles, grant schema USAGE to the already-authorized migration role through the operator's normal privilege process. PostgreSQL's extension files must also be available on restore hosts.

For a new Compose PostgreSQL volume, the read-only `deploy/postgres/initialize-search.sql` mount performs this preparation through the PostgreSQL initialization role. Initialization scripts are not replayed for an existing volume. Existing installations therefore require the operator step before running the new migration. The same requirement applies to native development databases. Test-only tooling prepares the extension only after validating the `_test` database name.

The migration adds body-only `posts.search_text`, backfills 64 articles at a time, sets NOT NULL and builds three verified indexes in the existing migration transaction. It preserves original Markdown and article timestamps. Backfill and index creation block writers; reserve a maintenance window, disk/WAL space and a verified backup. Failure rolls back the version and its changes. Review [query evidence and write costs](query-analysis.md) before applying the release to a larger corpus.

## First deployment

Run all commands from the repository root:

```bash
docker compose --env-file deploy/.env --profile tools config --quiet
docker compose --env-file deploy/.env --profile tools build --pull
docker compose --env-file deploy/.env up --detach --wait --wait-timeout 240
```

Compose waits for PostgreSQL readiness, runs the versioned migration to successful completion, waits for backend readiness, and then starts the frontend and Caddy. Check the public entry point:

```bash
curl --fail https://blog.example.com/health/ready
curl --fail https://blog.example.com/api/settings
```

Create the first administrator exactly once:

```bash
docker compose --env-file deploy/.env --profile tools run --rm seed
```

The seed command refuses to replace an existing account. Sign in, change the generated administrator password through Settings, and remove the obsolete `admin_password` file. Recreate a protected file only if the seed service is deliberately used on another empty database.

## Release upgrade

Lists and search return body-free summaries; Editor reads complete content through protected `GET /api/admin/posts/:id`. Search now defaults to a combined ten-result page and returns exact post/file totals. Build and deploy frontend and backend from the same revision and reload open clients. Prepare the extension prerequisite and apply all pending migrations, including `2026090601` and `2026090901`, before restarting the API. The latter adds article versions and an update trigger: old clients without versions cannot save, and publication now uses dedicated endpoints. This version migration changes no historical article content or timestamps and needs no additional extension. Reserve a maintenance window for its table lock; see [editor compatibility and behavior](editor.md). Keep the previous images and their matched backup; an image-only rollback across the new schema version is unsupported.

Migrations are forward-only, and a database backup must match the uploads captured during the same write-free interval. Use this sequence:

1. Fetch the reviewed release, choose a new immutable tag, and pre-build it without changing the current tag in `deploy/.env`.
2. Stop all public and application writers while leaving PostgreSQL running.
3. Create and verify a matched backup with the current maintenance image. This image expects the current pre-upgrade schema.
4. Prepare the search extension in the application database, then change `APP_IMAGE_TAG` in `deploy/.env` to the pre-built new tag.
5. Apply migrations from the new backend image.
6. Recreate the application services and verify readiness.

```bash
NEW_RELEASE=<immutable-release-tag>
APP_IMAGE_TAG="$NEW_RELEASE" docker compose --env-file deploy/.env --profile tools build --pull
docker compose --env-file deploy/.env stop caddy frontend backend
docker compose --env-file deploy/.env --profile tools run --rm maintenance /app/backup create /backups
docker compose --env-file deploy/.env --profile tools run --rm maintenance \
  /app/backup verify /backups/blog-studio-backup-YYYYMMDDTHHMMSSZ
# Have the database operator prepare pg_trgm in public before migration.
# Edit deploy/.env and set APP_IMAGE_TAG to $NEW_RELEASE only after verification.
docker compose --env-file deploy/.env run --rm migrate
docker compose --env-file deploy/.env up --detach --wait --wait-timeout 240
```

After the site returns, verify public reads, sign-in, an administrator read, file preview/download, and `/health/ready`. Keep the previous application images and the pre-upgrade backup until acceptance is complete.

## Rollback

If the migration command did not apply a new version, set `APP_IMAGE_TAG` back to the retained release and run `docker compose --env-file deploy/.env up --detach --wait` without rebuilding.

If any migration version was applied, an image-only rollback is unsupported: the previous binary deliberately rejects a newer migration history even when an individual schema change appears compatible. Stop application writers and restore the matched pre-upgrade bundle into isolated targets according to [`backup-restore.md`](backup-restore.md). Promote restored data only after the isolated verification succeeds. Never attempt to reverse a forward-only migration manually on the active database.

`docker compose down` preserves named volumes by default. Do not add `--volumes` during normal deployment, rollback, or troubleshooting: that option removes PostgreSQL, uploads, frontend cache, and Caddy state managed by this project.

## Operations and troubleshooting

Inspect service state and recent logs without printing the resolved Compose configuration:

```bash
docker compose --env-file deploy/.env ps
docker compose --env-file deploy/.env logs --tail 200 migrate backend frontend caddy postgres
```

- If `migrate` fails, leave the API stopped, inspect its error, verify the selected database and backup, then rerun the one-shot migration. Do not bypass the migration dependency.
- If `backend` is unhealthy, call `/health/ready` from the host and inspect PostgreSQL and upload-volume permissions. The response stays generic; the correlated cause is in backend logs.
- If Caddy cannot issue a certificate, verify DNS, public ports, system time, and persistence/write access for its data volume.
- If forwarded client addresses are wrong, confirm that `CADDY_TRUSTED_IP` matches Caddy's assigned address. Do not trust the whole internet or a broad host network.
- If legitimate public searches receive `429`, inspect the search rejection metric before adjusting `PUBLIC_SEARCH_RATE_PER_MINUTE` or `PUBLIC_SEARCH_BURST`. The limiter is per backend process and is not shared across replicas.
- If the configured subnet overlaps another Docker or host network, stop the project and change `APP_NETWORK_SUBNET`, `APP_NETWORK_IP_RANGE`, and `CADDY_TRUSTED_IP` together before recreating services. The dynamic range must be contained by the subnet and must exclude Caddy's fixed address.
- Do not change the PostgreSQL image to another major release as an ordinary application upgrade. Use a documented PostgreSQL major-upgrade or dump/restore procedure.

The committed CI workflow validates that the fixed proxy address is separated from the dynamic container pool, builds this topology, starts it with disposable secrets and volumes, and probes the public Caddy routes. That job is an ordinary repository check; branch-protection requirements remain a repository-administration decision.


## Build and dependency maintenance

The backend build stage is pinned to `golang:1.26.8-alpine`, matching `backend/go.mod` and CI. It compiles the API, migration, seed and backup/restore commands; rebuild both backend and maintenance targets after dependency fixes. The frontend continues to use Node.js 22, locked npm dependencies and standalone output. No environment variable, secret mount, database extension requirement or application port changes are needed.

[Dependency health](dependency-maintenance.md) reports npm and Go findings but does not audit OS image packages or run a deployment. CI keeps its full image-build and disposable Compose topology checks. Local native/cross-compilation evidence is distinct from those container results; run and review the latter after publishing the change.
