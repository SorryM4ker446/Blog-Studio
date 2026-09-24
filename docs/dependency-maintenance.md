# Dependency maintenance

The `Dependency health` workflow supports `workflow_dispatch` and runs Mondays at 03:31 UTC. GitHub schedules use the default branch, so scheduled execution starts after that workflow is merged there. The dependency workflow uses read-only repository permissions and reports findings without changing dependencies or publishing artifacts to a package registry. CI separately publishes deployment images for eligible production runs; see [automatic deployment](automatic-deployment.md).

## Checks and reports

| Ecosystem | Security check | Version inventory |
| --- | --- | --- |
| Frontend | `npm ci`, then `npm audit --json` for all locked production/development dependencies | `npm ls --all --json` and `npm outdated --json` |
| Backend | `go mod verify`, then pinned `govulncheck@v1.8.0` against `./...` | `go version` and `go list -m -u -json all` |

Audit findings and command/network failures fail the corresponding job. Normal newer-version results are information only: npm's exit code 1 is accepted solely with a valid, nonempty outdated report; malformed/error reports fail. No `npm audit fix`, broad `go get -u`, dependency bot or automatic PR is used. Available version reports still run after audit failure, and available artifacts are retained for 30 days. Failed or partial reports never establish a clean result.

Govulncheck uses verbose text output to retain reachable, package and module advisory details, and preserves its exit code; JSON mode must not be substituted without separately evaluating findings. Its call graph distinguishes reachable vulnerabilities from packages merely present in the module graph. An unsupported/unreachable package advisory is still recorded and reviewed; it is not a claim of exploitable application behavior. See [the Go vulnerability checker](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck) and the [risk register](security-risk-register.md).

## Update policy

- Review patch releases monthly, prioritizing security fixes immediately.
- Evaluate ordinary minor updates quarterly with release notes and relevant regression tests.
- Treat major migrations as separate reviewed work with compatibility, rollback and acceptance evidence.
- Update manifests and lockfiles together. Do not change versions merely to remove an informational outdated notice.
- Keep the Go version in `backend/go.mod`, CI setup and Docker build stage aligned. The backend and backup/restore maintenance binaries share that build stage.
- Rebuild deployment images after security updates; existing containers retain old compiled code. Node and Go checks do not audit OS image packages, Caddy or PostgreSQL. Review those maintained image lines and rebuild them through the container workflow as part of release maintenance.

## Current security update

The September 14–15, 2026 review found reachable advisories in Go 1.26.2, pgx 5.9.1 and quic-go 0.59.0. The repository now requires Go 1.26.8 and pins that Docker build image; pgx is 5.9.2 and quic-go 0.59.1. x/crypto is 0.56.0 to include reported SSH security fixes, with its required x/text 0.41.0. This replaces the older Go 1.25 build baseline while staying on the existing local toolchain's 1.26 release line.

The SSH/OpenPGP packages are not imported by this application, which uses x/crypto for bcrypt. The unmaintained OpenPGP package advisory has no fixed module version; retaining bcrypt does not justify importing OpenPGP. This boundary remains visible in govulncheck reports and the risk register. Ordinary frontend newer versions remain informational; the frontend lockfile was not upgraded.

Use matching PostgreSQL 18 clients and retain extension/restore permission checks. Local tests, vulnerability reports and native builds are evidence for those commands only; remote CI, container execution and deployment-host operation require their own results.
