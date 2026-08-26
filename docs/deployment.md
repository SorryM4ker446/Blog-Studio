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

For example, `SITE_ADDRESS=blog.example.com` pairs with `SITE_ORIGIN=https://blog.example.com`. Set `APP_IMAGE_TAG` to an immutable release identifier such as a Git commit SHA. If the default Docker subnet conflicts with a host network, change `APP_NETWORK_SUBNET` and choose `CADDY_TRUSTED_IP` inside that subnet.

Create the three secret files as described in [`deploy/secrets/README.md`](../deploy/secrets/README.md). Compose mounts a secret only into services that declare it. The backend accepts either the existing direct variables or their `_FILE` alternatives; when both forms of the same value are set, startup fails instead of choosing one silently.

Prepare the host-visible backup directory for the non-root maintenance container:

```bash
mkdir -p deploy/backups
sudo chown 10001:10001 deploy/backups
chmod 700 deploy/backups
```

Do not put passwords, JWT values, database DSNs, or restored data in `deploy/.env`. The committed file contains only non-secret settings and secret file paths.

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

Migrations are forward-only, and a database backup must match the uploads captured during the same write-free interval. Use this sequence:

1. Fetch the reviewed release, choose a new immutable tag, and pre-build it without changing the current tag in `deploy/.env`.
2. Stop all public and application writers while leaving PostgreSQL running.
3. Create and verify a matched backup with the current maintenance image. This image expects the current pre-upgrade schema.
4. Change `APP_IMAGE_TAG` in `deploy/.env` to the pre-built new tag.
5. Apply migrations from the new backend image.
6. Recreate the application services and verify readiness.

```bash
NEW_RELEASE=<immutable-release-tag>
APP_IMAGE_TAG="$NEW_RELEASE" docker compose --env-file deploy/.env --profile tools build --pull
docker compose --env-file deploy/.env stop caddy frontend backend
docker compose --env-file deploy/.env --profile tools run --rm maintenance /app/backup create /backups
docker compose --env-file deploy/.env --profile tools run --rm maintenance \
  /app/backup verify /backups/blog-studio-backup-YYYYMMDDTHHMMSSZ
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
- If the configured subnet overlaps another Docker or host network, stop the project and change both `APP_NETWORK_SUBNET` and `CADDY_TRUSTED_IP` before recreating services.
- Do not change the PostgreSQL image to another major release as an ordinary application upgrade. Use a documented PostgreSQL major-upgrade or dump/restore procedure.

The committed CI workflow builds this topology, starts it with disposable secrets and volumes, and probes the public Caddy routes. That job is an ordinary repository check; branch-protection requirements remain a repository-administration decision.
