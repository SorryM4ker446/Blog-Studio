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

The September 14–15, 2026 review found reachable advisories in Go 1.26.2, pgx 5.9.1 and quic-go 0.59.0. pgx remains at 5.9.2 and quic-go at 0.59.1. The October 12 dependency report identified eight reachable standard-library advisories on Go 1.26.8, including HTTP/2 advisories also affecting x/net 0.57.0. The repository now requires Go 1.26.9 and pins `golang:1.26.9-alpine` for the shared backend and maintenance build stage. x/net is 0.60.0, with its required x/crypto 0.57.0, x/sync 0.23.0, x/sys 0.48.0 and x/text 0.42.0. See [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) for the standard-library and x/net patch boundary. Rebuild backend and maintenance images to apply these fixes.

The SSH/OpenPGP packages are not imported by this application, which uses x/crypto for bcrypt. The unmaintained OpenPGP package advisory has no fixed module version; retaining bcrypt does not justify importing OpenPGP. This boundary remains visible in govulncheck reports and the risk register.

The October 2026 frontend security update pins Next.js and its ESLint configuration to 16.3.8 and markdown-it to 15.0.2. The lockfile also updates undici to 7.29.1 and the two brace-expansion release lines to 1.1.21 and 5.0.12, within their existing consumers' dependency ranges. The October 12 update locks sharp to 0.35.5 (including its matching platform binaries and libvips 1.3.4) and source-map-js to 1.2.2 within their existing consumers' ranges, addressing [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Rebuild frontend deployment images to apply these updates.

The development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain still contains braces 3.0.3. GHSA-vfj7-8cjw-p6xm has no upstream patched release as of October 12, 2026. Full dependency auditing continues to report it and fail the frontend health job, including the affected parent packages. During weekly dependency-report review, check the [upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and the dependent packages' releases for a compatible fix; validate lint, tests and production build before updating the lockfile. See the [risk register](security-risk-register.md) for the input boundary; a clean production-only audit does not establish a clean full dependency tree. Ordinary newer versions remain informational.

Use matching PostgreSQL 18 clients and retain extension/restore permission checks. Local tests, vulnerability reports and native builds are evidence for those commands only; remote CI, container execution and deployment-host operation require their own results.
