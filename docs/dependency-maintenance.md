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

The September 14–15, 2026 review found reachable advisories in Go 1.26.2, pgx 5.9.1 and quic-go 0.59.0. pgx remains at 5.9.2 and quic-go at 0.59.1. The October 12 dependency report identified eight reachable standard-library advisories on Go 1.26.8, including HTTP/2 advisories also affecting x/net 0.57.0. x/net is 0.60.0, with its required x/crypto 0.57.0, x/sync 0.23.0, x/sys 0.48.0 and x/text 0.42.0. See [GO-2026-6617](https://pkg.go.dev/vuln/GO-2026-6617) for that standard-library and x/net patch boundary. The October 26 report identified reachable [GO-2026-6809](https://pkg.go.dev/vuln/GO-2026-6809) in `crypto/x509` on Go 1.26.9. The repository now requires Go 1.26.10 and pins `golang:1.26.10-alpine` for the shared backend and maintenance build stage, adding the denylist for compromised intermediate certificates. Rebuild backend and maintenance images to apply these fixes.

The SSH/OpenPGP packages are not imported by this application, which uses x/crypto for bcrypt. The unmaintained OpenPGP package advisory has no fixed module version; retaining bcrypt does not justify importing OpenPGP. This boundary remains visible in govulncheck reports and the risk register.

The October 26 frontend security update pins Next.js and its ESLint configuration to 16.4.3, markdown-it to 15.0.3, and Vitest/V8 coverage to 4.1.12. Next.js includes fixes for the [Image Optimization API](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Server Actions denial of service](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), and [`use cache` typed-array handling](https://github.com/advisories/GHSA-673q-mjm6-r5xr). markdown-it fixes quadratic parsing of link reference definitions even with raw HTML disabled; both public articles and editor previews use the shared parser. See [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c). Vitest's matching mocker update addresses [manual mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and the [Windows redirect traversal bypass](https://github.com/advisories/GHSA-xp26-3454-mjgp).

The lockfile updates the development dependencies Vite to 8.3.5, undici to 7.30.1 and zod to 4.6.7 within their existing consumers' ranges. These address Vite's development-server and launch-editor advisories, undici's response handling and integrity checks, and zod's oversized-collection memory exhaustion. Representative advisories are [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) and [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Earlier fixes remain locked: sharp 0.35.5 with its matching platform binaries and libvips 1.3.4, source-map-js 1.2.2, and brace-expansion 1.1.21/5.0.12. Rebuild frontend deployment images to apply the runtime updates.

The development-only `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` chain still contains braces 3.0.3. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on October 23, 2026 because the reported issue was not practically exploitable; its absence from current audit findings is an advisory-status change, not a patched braces release. Keep full production/development auditing enabled and review findings against their actual input boundaries in the [risk register](security-risk-register.md). A clean production-only audit does not establish a clean full dependency tree. Ordinary newer versions remain informational.

Use matching PostgreSQL 18 clients and retain extension/restore permission checks. Local tests, vulnerability reports and native builds are evidence for those commands only; remote CI, container execution and deployment-host operation require their own results.
