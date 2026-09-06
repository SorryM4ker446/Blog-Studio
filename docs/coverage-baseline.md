# Coverage Baseline

Measured on 2026-09-06 before changing application behavior, from revision `2ecefe6` plus coverage-reporting configuration. The frontend suite at that baseline had 25 files and 89 passing tests. PostgreSQL integration, migration and real backup/restore tests ran with native PostgreSQL 18.3 tools.

| Metric | Covered / total | Baseline | Proposed future global floor |
| --- | ---: | ---: | ---: |
| Vitest statements | 1,119 / 2,171 | 51.54% | 49% |
| Vitest branches | 981 / 2,025 | 48.44% | 46% |
| Vitest functions | 225 / 453 | 49.66% | 47% |
| Vitest lines | 1,083 / 1,999 | 54.17% | 52% |
| Go statements | 1,657 / 2,466 | 67.2% | 65% |

These are baseline measurements and proposed conservative floors, not enforced gates. Re-measure on CI's operating system/toolchain before enabling floors. Do not lower a floor or exclude a difficult file to hide a regression. Time-based benchmark thresholds are independent of coverage and remain disabled.

## Article read regression measurement

Measured on 2026-09-06 after the summary/detail implementation, using the same whole-source scope and toolchain. The earlier baseline remains the comparison reference; no coverage floor is enabled by this change.

| Metric | Covered / total | Result |
| --- | ---: | ---: |
| Vitest statements | 1,167 / 2,193 | 53.21% |
| Vitest branches | 1,005 / 2,023 | 49.67% |
| Vitest functions | 238 / 460 | 51.73% |
| Vitest lines | 1,126 / 2,015 | 55.88% |
| Go statements | 1,677 / 2,479 | 67.6% |

All 101 frontend tests in 25 files pass. The new detail loader has 100% statement, line, function and branch coverage, including cancellation and late rejection. The removed duplicate frontend Markdown filter is tested at its remaining backend owner; no production file is excluded to improve the metric. Go race tests, native migration and real backup/restore checks pass. Windows still skips the existing symlink-content test because creating a symlink requires an unavailable OS privilege. The opt-in query experiment runs separately from the ordinary test suite.

## Fixed measurement scope

`npm run test:coverage` uses Vitest/V8 4.1.11 and includes all `src/**/*.{ts,tsx}`, excluding only test files, test setup and declaration files. Reports in `frontend/coverage` include text, HTML, LCOV and JSON summary. Untested production files remain in the denominator. Keep the Vitest coverage provider version aligned with Vitest on upgrades.

Async server components, browser layout, hydration and native navigation still require Playwright. The Next.js testing guide shipped at `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` recommends E2E for async components. Their source is not silently removed from this global baseline, and Playwright execution is not merged into V8 unit coverage.

Go uses `-coverpkg=./...` so routes exercising handlers contribute to the handler coverage. Use the aggregate `go tool cover -func` result, not the average of package output. All module packages, including command entrypoints and test utility production files, remain included. The profile uses atomic mode with the race detector. HTML, profile, function summary and JSON test events are uploaded by CI.

Go's native metric is **statement/block coverage**, not branch coverage. The recommended new-search and publication gate is at least 90% statement coverage in focused logic plus explicit tests for every decision outcome, including rejection, retries and conflicts. This does not provide a numeric Go branch percentage. If numeric Go branch coverage is required, evaluate a separate instrumenter and its race/Windows/Linux compatibility before setting that gate.

For new frontend search, recovery-copy and publication logic, target at least 90% branch coverage in focused modules in addition to the global floors. Gate implementation and dependency-health scheduling are separate remaining work.

## Reproduce

From `frontend`:

~~~powershell
npm run test:coverage
~~~

From `backend`, with `TEST_DB_DSN` already configured for a disposable database ending in `_test` and matching PostgreSQL tools on PATH:

~~~powershell
go test -race -p 1 '-covermode=atomic' '-coverpkg=./...' '-coverprofile=coverage.out' -json ./... | Tee-Object test-results.json
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
go tool cover '-func=coverage.out' | Set-Content coverage-summary.txt
go tool cover '-html=coverage.out' '-o=coverage.html'
~~~

Quoting dotted Go flags avoids PowerShell argument parsing surprises. Reports are ignored by Git and Docker build contexts. CI retains coverage and backend test artifacts for 30 days even when a test fails; incomplete reports from failed runs do not establish a passing baseline.
