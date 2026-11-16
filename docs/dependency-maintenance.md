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

The November 16, 2026 dependency report found reachable [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859) in Go 1.26.10's `net/http`. Go 1.26.11 fixes it and is pinned in both `backend/go.mod` and the shared `golang:1.26.11-alpine` build stage. Rebuild both the backend and maintenance images to apply the standard-library fix. The module graph uses x/net 0.62.0 to address [GO-2026-6860](https://pkg.go.dev/vuln/GO-2026-6860) and [GO-2026-6866](https://pkg.go.dev/vuln/GO-2026-6866), which the report found at module level, and x/crypto 0.59.0 with its required companion modules.

The application's use of x/crypto is limited to bcrypt. x/crypto 0.59.0 removes the unmaintained OpenPGP packages. See the [risk register](security-risk-register.md) before adding cryptographic functionality.

Next.js and its ESLint configuration are pinned to 16.4.6, which includes the [root-parameter cache isolation fix](https://github.com/advisories/GHSA-mfr8-8qww-v76h). The ESLint dependency chain uses typescript-eslint 8.73.0 and minimatch 11.0.8, addressing the [glob amplification advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) reported by the November 16 health run and the [minimatch 11 cache memory exhaustion advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-hqmv-qgp3-jx75).

markdown-it 15.0.3 fixes quadratic parsing of link reference definitions even with raw HTML disabled. Both public articles and editor previews use the shared parser. See [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c). The matching Vitest/V8 coverage and mocker updates address [manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and the [Windows redirect traversal bypass](https://github.com/advisories/GHSA-xp26-3454-mjgp).

The lockfile uses Vite 8.3.5, undici 7.30.1 and zod 4.6.7 within their existing consumers' ranges. These address Vite's development-server and launch-editor advisories, undici's response handling and integrity checks, and zod's oversized-collection memory exhaustion. Representative advisories are [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) and [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The lockfile also includes sharp 0.35.5 with its matching platform binaries and libvips 1.3.4, source-map-js 1.2.2, and brace-expansion 1.1.21/5.0.13. Rebuild frontend deployment images to apply the runtime updates.

The development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain still contains braces 3.0.3. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on October 23, 2026 because the reported issue was not practically exploitable; its absence from current audit findings is an advisory-status change, not a patched braces release. Keep full production/development auditing enabled and review findings against their actual input boundaries in the [risk register](security-risk-register.md). A clean production-only audit does not establish a clean full dependency tree. Ordinary newer versions remain informational.

Use matching PostgreSQL 18 clients and retain extension/restore permission checks. Local tests, vulnerability reports and native builds are evidence for those commands only; remote CI, container execution and deployment-host operation require their own results.
