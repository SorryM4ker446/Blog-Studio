# GitHub Actions deployment to a VPS

This is an opt-in upgrade path for an **existing, healthy Linux Docker Compose installation**. It does not provision a VPS, initialize an administrator, or replace a database. Complete [first deployment](deployment.md) before enabling it. Nothing deploys until the repository variable `ENABLE_VPS_DEPLOY=true` is configured.

## Release flow

`CI` runs frontend coverage/build, backend tests, browser tests, container topology checks, and deployment-script tests, then publishes images for eligible successful production-branch push/manual runs. A separate `CD` workflow starts after CI completes on a source branch matching `main` or `master`. Its gate requires success, the same source repository, `.github/workflows/ci.yml`, a push/manual source event and the configured production branch. Pull requests never publish or deploy.

The `workflow_run.branches` filter applies to the source CI branch, not a pull request's target branch. CI for a `codex` or feature-branch PR targeting `main` therefore does not create a CD run; CI after merging into `main` still does. This filter does not filter CI conclusions or event types: failed CI on an allowed branch, or a PR whose source branch itself is `main` or `master`, can still create a skipped CD run. The job-level trust gate remains required. Keep the CD branch allowlist and CI push branches synchronized if supporting another production branch; changing `DEPLOY_BRANCH` alone does not extend these trigger filters. The updated CD workflow must reach the repository's default branch before the filter takes effect.

CD checks out the source CI run's exact `head_sha` and downloads image metadata from that run ID, not the latest run. It uses the source CI `run_number` as the deployment sequence, preserving ordering across the split; the new CD run number must never replace it. The CD run ID/attempt only identifies the uploaded release directory. Deployment retries do not rebuild images or rerun tests. Only CD receives the production SSH secrets; image publishing retains narrowly scoped package-write permissions in CI.

Three independent GHCR images are built from the same commit in one package: frontend `runtime`, backend `runtime`, and backend `maintenance`. Service-prefixed SHA tags identify releases; the server actually uses **digests** recorded separately by those builds. Architecture and OCI revision are checked before downtime. The matching Compose file, Caddy configuration, initialization SQL, and deployment script arrive over SSH/SFTP; no secrets or application source are uploaded into the live checkout.

The server takes a Linux file lock, rejects older CI run numbers, captures running image IDs, pulls new images, then stops Caddy/frontend/backend. PostgreSQL remains running. The old maintenance image runs `backup create`, which verifies storage consistency and the archive before publishing a complete bundle. New migrations run, services restart with health checks, and public HTTPS readiness/settings/links endpoints are checked. Only then does the current-release pointer change.

There is a maintenance window during backup/migration. This is not zero downtime. Additional writers outside this Compose stack must be stopped separately; do not enable unattended deployment while such writers exist.

## Review before approving production

CD first runs `prepare-release` without the production environment or SSH secrets. Open the CD run's **Summary** after that job succeeds to review:

- the exact commit and branch, with links to the commit and successful source CI run;
- associated pull requests for that commit (up to 100), or an explicit no-match/API-unavailable notice;
- the frontend, backend and maintenance digest-pinned images downloaded from that exact CI run;
- the release manifest checksum and the migrations registered in the checked-out release.

The migration section lists the release's full registry, not a computed difference against production. The summary job does not contact the VPS, inspect its database, or verify an existing backup. The deployment stage still creates and verifies its backup before running pending migrations; a failed backup blocks migration. Follow the recovery procedure if migration has begun rather than rolling back only an image.

`deploy-production` depends on successful preparation and artifact upload. With required reviewers configured on `production`, it waits for approval only after the summary is available. Read Summary, then select **Review deployments → production → Approve and deploy**. If no required reviewers are configured, deployment proceeds automatically after preparation.

The reviewed `release.json` and a copy of the summary are saved in a CD artifact named by CD run ID and attempt, retained for 30 days. Deployment downloads that artifact from the same CD run and checks its SHA-256, source commit and CI sequence before any SSH action. It does not rebuild images or re-read mutable tags. Missing/malformed image metadata, foreign-package references, unreadable migration metadata, or a missing/changed reviewed manifest block deployment. An unavailable PR lookup is clearly reported but does not block an otherwise valid release.

Retrying only failed jobs reuses the successful preparation outputs and its artifact. Rerunning the whole workflow prepares a new artifact for that attempt and produces a new summary. If artifacts expire or are deleted, rerun preparation while the original CI image metadata remains available (retained for 14 days), or run CI again for the intended commit. Do not substitute another release's artifact. The default branch and the selected CI commit must contain the new preparation script before this workflow can deploy that release; old commits without it fail preparation safely.

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
ghcr.io/<owner>/<repository>:frontend-<commit-sha>
ghcr.io/<owner>/<repository>:backend-<commit-sha>
ghcr.io/<owner>/<repository>:maintenance-<commit-sha>
```

For a repository named `Blog-Studio`, this creates one `blog-studio` package with three independently built images. There is no shared `latest` tag to overwrite between services. Deployment metadata still contains a separate digest for each service; migrate/seed continue to use the backend image.

When upgrading from the three-package layout, grant the publishing repository and VPS read account access to the new package before enabling deployment. The old packages are not renamed or deleted automatically. Retain their digests/images while current/previous releases or recovery procedures reference them. Existing release manifests remain valid, and local Compose build names do not change.

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
| Secret | `VPS_HOST` | IPv4 address or DNS hostname; IPv6 literals are not accepted |
| Secret | `VPS_PORT` | Optional SSH port; defaults privately to `22` in the deployment script |
| Secret | `VPS_USER` | Deployment account |
| Secret | `VPS_DEPLOY_PATH` | Existing absolute root, e.g. `/srv/Blog-Studio`; no spaces or shell metacharacters |
| Secret | `VPS_SSH_PRIVATE_KEY` | Complete private key, including BEGIN/END lines |
| Secret | `VPS_KNOWN_HOSTS` | Verified known_hosts record for this host/port |

Enable/branch/platform must be repository variables: image publishing runs before entering the production environment. Approval requirements, if desired and supported by your plan, belong to that environment. Without required approval, eligible successful runs deploy automatically. Protect the branch and review workflow/script changes.

For existing installations, copy the four VPS connection settings from production Variables to same-named production Secrets, then remove the old Variables. There is intentionally no Variables fallback: runner step headers can expose their values before the deployment script starts. Missing required Secrets fail before SSH. Secrets are masked by GitHub; the dispatcher additionally captures SSH/SCP diagnostics and reports transport failures without command arguments or server paths. Inspect SSH connectivity privately when a transport failure occurs.

This change only protects future runs. Review and delete previously exposed Actions logs through GitHub's log controls; changing Variables to Secrets does not retroactively sanitize historical logs. Do not paste existing values into issues, source files or migration notes.

The site URL is read from the existing VPS configuration. No duplicate `SITE_URL` setting or database/JWT secret in GitHub is needed. The VPS does not need repository access; release files arrive over SSH/SFTP.

## First run and operation

1. Review, commit/push and merge this implementation yourself, keeping automation disabled initially.
2. Complete VPS setup, retain the old maintenance image, and configure GitHub.
3. Set `ENABLE_VPS_DEPLOY=true`.
4. Ensure `cd.yml` exists on the default branch, then open **Actions → CI → Run workflow** and select the production branch. All checks and image publishing run before CD.
5. Inspect CI `publish-images`, then the separate **Actions → CD → deploy-production** run. Verify login, saving articles, file previews/downloads and Links in the browser.
6. Future pushes/merges to the production branch deploy automatically. PRs and `codex` do not deploy.

`workflow_run` runs the CD workflow from the default branch. Its production Environment branch rules must allow that default branch; the explicit CD gate separately restricts the source CI branch to `DEPLOY_BRANCH`. Prefer using the default branch as the production branch. Keep the CI workflow name `CI`, its file path, and its run-number history stable. Renaming/recreating the source workflow requires reviewing the server's sequence guard.

To retry a transport or cleanup problem, first inspect server state and resolve any deployment guard, then use **Re-run failed jobs** (or **Re-run all jobs** for a successful run with a cleanup warning) on the corresponding CD run. The same source artifacts are retained for 14 days. Expired artifacts require a new CI run on the intended production revision; do not substitute artifacts from another run. Do not retry pre-split CI releases through CD: start a new CI run containing both workflow changes and the updated dispatcher. A newer successful deployment still prevents an older run from replacing it.

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
    cleanup.json                 # removed/protected/failed old image counts
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

Never remove migration history or run `down --volumes`. Do not manually prune images, bundles or backups referenced by the current/previous release. Force-pushing or resetting CI run numbering is not a rollback mechanism.

## VPS image retention

After health checks pass, the current-release pointer is committed and the deployment guard is cleared. While still holding the server deployment lock, automatic cleanup retains the **latest three distinct successfully deployed commit versions**, each with frontend/backend/maintenance images (normally nine images, with shared layers counted once by Docker). Repeating the same SHA does not consume another version slot. Ordering uses the source CI sequence, not image creation time or directory timestamps. A same-SHA CD retry also retries cleanup.

Only obsolete application digest references recorded in this installation's successful release manifests are candidates. Cleanup protects the active release, its immediate rollback image IDs, all unsuccessful/incomplete release manifests and their rollback snapshots, and all running or stopped containers. A shared local image ID is preserved if any retained reference needs it. Manually tagged images are left alone. It uses explicit `docker image rm` without force; it never calls `system prune`, removes containers/volumes, deletes GHCR packages or touches unrelated images.

Safety exceptions can leave more than three versions. Candidate removals blocked by containers, tags or shared image IDs, and failed deletions, are reported in the successful deployment's message and private `cleanup.json`. Unsuccessful/incomplete releases and recovery references are excluded from the candidate set entirely. Invalid metadata, inventory errors or an unresolved guard prevent cleanup. A cleanup failure does not roll back or mark the healthy application release as failed; review its warning and private server log, resolve the cause and rerun CD. Interrupted releases remain protected until an operator reconciles their actual state. Do not mark them successful just to free space.

This is a local application-image policy, not a total disk quota. Bootstrap/local-build images without successful release manifests, manually tagged images, backups, database/uploads, container logs, build cache and release metadata are not automatically deleted. Leave headroom for pulling a new version and creating its backup before cleanup; a full disk can prevent reaching cleanup. Monitor `docker system df` and filesystem free space, and maintain separate reviewed backup/log retention and off-host backup policies. Older recovery may require re-pulling the exact retained GHCR digest; keep registry images needed by backup recovery procedures.

## Validation

Install test dependencies with `python -m pip install -r deploy/tests/requirements.txt`, then run `python -m unittest discover -s deploy/tests -v`. Fault-injection tests cover pull/backup/migration/health failures, ordering, immutable images, architecture checks, idempotence, stale-run rejection, persistent guards and SSH parameter validation. The real Compose parser verifies preserved volumes and versioned configuration mounts; Linux CI exercises `flock`. Retention tests cover three-version selection, repeated SHAs, stopped containers, shared image IDs, manual tags, incomplete releases, corrupted metadata, failed removals and repeat execution. Workflow gate tests exercise failed/PR/fork/non-production events and source CI identity bindings. Existing container CI still builds/boots the topology. Actual registry authentication, GitHub workflow chaining, Docker image removal, SSH permissions, HTTPS and VPS deployment require a real environment run.

## Approval summary privacy

Treat the Summary and its artifacts as public release information in a public repository. Output is limited to repository/commit/CI/PR identifiers and links, the production branch name, validated image references, manifest checksum, registered migration identifiers/names, and fixed operational guidance. Commit messages, PR titles/bodies, author email addresses, complete GitHub event/API responses, environment dumps and server diagnostics are not copied into the report.

Preparation has no production environment, SSH credentials or VPS access. Its GitHub token is used only for the authenticated PR lookup and is never written to the summary or release manifest. PR lookup failures and preparation failures use fixed messages without raw exception diagnostics. Artifact upload explicitly includes only `release.json` and `summary.md`, not an entire directory. The deploy job retains the existing production Secret bindings and private SSH diagnostic handling. This does not erase any information already published in earlier workflow runs or repository history; maintain secrets in production environment Secrets and never in commit/branch/migration names or public metadata.
