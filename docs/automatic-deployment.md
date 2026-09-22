# GitHub Actions deployment to a VPS

This is an opt-in upgrade path for an **existing, healthy Linux Docker Compose installation**. It does not provision a VPS, initialize an administrator, or replace a database. Complete [first deployment](deployment.md) before enabling it. Nothing deploys until the repository variable `ENABLE_VPS_DEPLOY=true` is configured.

## Release flow

The existing `CI` workflow runs frontend coverage/build, backend tests, browser tests, container topology checks, and deployment-script tests. Only successful push/manual runs on the configured production branch publish images. Pull requests never publish or deploy.

Three GHCR images are built from the same commit: frontend `runtime`, backend `runtime`, and backend `maintenance`. SHA tags identify releases; the server actually uses **digests** recorded by those builds. Architecture and OCI revision are checked before downtime. The matching Compose file, Caddy configuration, initialization SQL, and deployment script arrive over SSH/SFTP; no secrets or application source are uploaded into the live checkout.

The server takes a Linux file lock, rejects older CI run numbers, captures running image IDs, pulls new images, then stops Caddy/frontend/backend. PostgreSQL remains running. The old maintenance image runs `backup create`, which verifies storage consistency and the archive before publishing a complete bundle. New migrations run, services restart with health checks, and public HTTPS readiness/settings/links endpoints are checked. Only then does the current-release pointer change.

There is a maintenance window during backup/migration. This is not zero downtime. Additional writers outside this Compose stack must be stopped separately; do not enable unattended deployment while such writers exist.

## One-time VPS preparation

Requirements:

- Linux, Python **3.10+**, Docker Engine, Compose plugin **2.20+**, OpenSSH/SFTP, `tar`, and `curl`.
- An existing running project, retaining its Compose project name, volumes, `deploy/.env`, secrets and HTTPS origin.
- A deployment user able to run Docker without interactive sudo, read configuration, and write `deploy/.deployment`. Docker access is effectively host-administrator access; use a dedicated key/account.
- SSH reachable from GitHub-hosted runners, outbound HTTPS to GHCR, and enough disk for retained images/backups. PostgreSQL does not need a public port.
- A separate policy to copy verified bundles to protected off-host storage. Automation creates local bundles; it is not an off-host backup service.

Use the same account for setup, registry login and Actions. From the existing project root:

```bash
python3 --version
docker compose version
docker compose --env-file deploy/.env ps
mkdir -p deploy/.deployment
chmod 700 deploy/.deployment
```

Preserve existing secrets. Ensure the configured backup directory is writable by maintenance UID/GID `10001`. For the default `BACKUP_DIR`:

```bash
mkdir -p deploy/backups
sudo chown 10001:10001 deploy/backups
sudo chmod 700 deploy/backups
```

If customized, use the actual backup directory instead. Before updating the server checkout, retain a maintenance image built from the **currently deployed revision**, using the existing `APP_IMAGE_TAG`. If missing, build it while the checkout still matches that release:

```bash
docker compose --env-file deploy/.env --profile tools build maintenance
```

Do not label a new maintenance binary as the old release: it will reject the pre-upgrade schema. The initial automatic run captures this old image ID for backup; later runs use the previous release's digest. Do not clean images during deployments.

The bootstrap `compose.yaml` and `.env` must accurately describe the running installation. Do not rename its project, change database/upload mounts, or rotate database credentials while enabling automation. PostgreSQL and Caddy images are pinned to their running image IDs, so their version upgrades remain separate maintenance work.

## SSH and GHCR credentials

Generate a dedicated key on your computer:

```bash
ssh-keygen -t ed25519 -f github-actions-deploy -C github-actions-deploy
```

The transport uses a private key without an interactive passphrase or agent. Protect it as a production credential. Add its public key to the deployment user's `~/.ssh/authorized_keys`. OpenSSH's `restrict` key option can disable forwarding/PTY access; exec and SFTP must remain available. Verify key login first.

Store a **verified** known_hosts entry in GitHub. Compare its fingerprint with the host key through your trusted server console (e.g. `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). `ssh-keyscan` alone does not establish trust. Nonstandard ports use `[host]:port` in known_hosts. Host-key checking is always enabled.

Actions publishes with its `GITHUB_TOKEN` and `packages: write`. Image names are automatically lowercased:

```text
ghcr.io/<owner>/<repository>-frontend
ghcr.io/<owner>/<repository>-backend
ghcr.io/<owner>/<repository>-maintenance
```

Private packages require the VPS account to log in once with a personal access token (classic) authorized for those packages and `read:packages`; organization SSO authorization may also be needed. Enter it interactively:

```bash
read -rsp 'GHCR read token: ' GHCR_READ_TOKEN
printf '\n'
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
unset GHCR_READ_TOKEN
```

Prefer a Docker credential helper and restrict account configuration access. Expired credentials cause a pull failure before downtime. Public packages need no read credential. For existing packages, grant this repository Actions access. No personal write token is required in Actions.

## GitHub settings

In **Settings → Secrets and variables → Actions → Variables**, add repository variables:

| Name | Value |
| --- | --- |
| `ENABLE_VPS_DEPLOY` | Keep `false` during preparation; then set `true` |
| `DEPLOY_BRANCH` | `main` (default) or `master`, matching the workflow push branches |
| `VPS_PLATFORM` | `linux/amd64` (default) or `linux/arm64`, matching the VPS |

Create **Settings → Environments → production**, restrict it to the production branch, and add:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `VPS_HOST` | IPv4 address or DNS hostname; IPv6 literals are not accepted |
| Variable | `VPS_PORT` | SSH port; default `22` |
| Variable | `VPS_USER` | Deployment account |
| Variable | `VPS_DEPLOY_PATH` | Existing absolute root, e.g. `/srv/Blog-Studio`; no spaces or shell metacharacters |
| Secret | `VPS_SSH_PRIVATE_KEY` | Complete private key, including BEGIN/END lines |
| Secret | `VPS_KNOWN_HOSTS` | Verified known_hosts record for this host/port |

Enable/branch/platform must be repository variables: image publishing runs before entering the production environment. Approval requirements, if desired and supported by your plan, belong to that environment. Without required approval, eligible successful runs deploy automatically. Protect the branch and review workflow/script changes.

The site URL is read from the existing VPS configuration. No duplicate `SITE_URL` setting or database/JWT secret in GitHub is needed. The VPS does not need repository access; release files arrive over SSH/SFTP.

## First run and operation

1. Review, commit/push and merge this implementation yourself, keeping automation disabled initially.
2. Complete VPS setup, retain the old maintenance image, and configure GitHub.
3. Set `ENABLE_VPS_DEPLOY=true`.
4. Open **Actions → CI → Run workflow** and select the production branch. All checks run before publishing/deployment.
5. Inspect `publish-images` and `deploy-production`. Verify login, saving articles, file previews/downloads and Links in the browser.
6. Future pushes/merges to the production branch deploy automatically. PRs and `codex` do not deploy.

The server process is detached from SSH. Losing the runner connection or cancelling polling does not terminate migrations. GitHub concurrency and the server lock prevent simultaneous deployments. Commands have deadlines (backup 35 minutes, others 30 minutes; health requests 30 seconds). Polling lasts up to 90 minutes. If it fails, inspect the running job before retrying. Pending GitHub runs can be superseded; active deployments are not automatically cancelled.

Private, Git-ignored runtime state:

```text
deploy/.deployment/
  lock
  current.json                  # successful commit, sequence, release path
  attention.json                # downtime or unresolved failure
  releases/<run-id>-<attempt>/
    compose.yaml
    images.json                 # immutable image overrides
    release.json
    previous.json
    previous-images.json
    deploy.log
    status.json
```

JSON manifests contain no credentials. Raw logs stay private on the VPS and include the backup bundle path; review them before sharing. Backups use the existing `BACKUP_DIR`.

After adoption, the original `.env` image tag is **not** the active selector. Plain root `docker compose up` would select bootstrap images. Copy `deploy/release.py` from this release to the root once, or invoke its copy inside the active bundle, then use:

```bash
python3 deploy/release.py compose /srv/Blog-Studio ps -a
python3 deploy/release.py compose /srv/Blog-Studio logs --tail 100 backend frontend caddy
```

Do not mutate services manually during deployment. Root `.env` and secrets remain authoritative configuration; do not edit them during a deployment. The helper does not clear failure guards.

## Failure handling

- Validation/pull failure: services remain running.
- Backup failure: old services are restarted; the run fails, but the guard is removed if recovery succeeds.
- Migration/start/health failure: `attention.json` remains and blocks future deployments. A failed migration command may already have applied an earlier version; image rollback is never guessed.
- Process death or host restart during downtime: the guard persists. Docker restart policies may start containers after reboot; inspect actual state.

Review `deploy.log`, `status.json`, `previous.json`, the backup bundle and database migration history. To inspect a failed release:

```bash
ROOT=/srv/Blog-Studio
RELEASE="$ROOT/deploy/.deployment/releases/ACTUAL-RUN-ATTEMPT"
docker compose --project-directory "$ROOT" --env-file "$ROOT/deploy/.env" \
  -f "$RELEASE/compose.yaml" -f "$RELEASE/images.json" ps -a
```

Do not just delete the guard: the old maintenance image may no longer match the schema. Either finish and validate the attempted release, then reconcile `current.json` with its SHA/sequence/path, or restore the matched backup into isolated targets with the old release as described in [backup and restore](backup-restore.md). Only after database/uploads/running images/current pointer agree, and no job holds the lock, may an operator remove `attention.json` and retry.

Never remove migration history or run `down --volumes`. Do not prune images, bundles or backups referenced by the current/previous release. Retention is manual: monitor disk usage and remove only reviewed, unreferenced artifacts after acceptance and off-host backup verification. Force-pushing or resetting CI run numbering is not a rollback mechanism.

## Validation

Run `python -m unittest discover -s deploy/tests -v`. Fault-injection tests cover pull/backup/migration/health failures, ordering, immutable images, architecture checks, idempotence, stale-run rejection, persistent guards and SSH parameter validation. The real Compose parser verifies preserved volumes and versioned configuration mounts; Linux CI exercises `flock`. Existing container CI still builds/boots the topology. Actual registry authentication, SSH permissions, HTTPS and VPS deployment require the first real run.
