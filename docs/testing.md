# Automated Testing

Blog Studio uses an isolated PostgreSQL database for integration and browser tests. Test tooling refuses to connect unless the configured database name ends in `_test`.

## Test database

Create a dedicated database such as `blog_db_test`. Never point `TEST_DB_DSN` at the development database `blog_db`.

PowerShell example:

```powershell
$env:TEST_DB_DSN = "host=localhost user=postgres password=your_password dbname=blog_db_test port=5432 sslmode=disable TimeZone=Asia/Shanghai"
```

The integration test helper validates the database name before installing the test-only `pg_trgm` prerequisite, applying migrations or running `TRUNCATE`. `go run ./cmd/testsetup --migrate-only` performs guarded preparation without resetting rows; CI and Playwright server startup use it. Production uses the separate operator extension procedure and `cmd/migrate`. The Playwright setup resets this isolated database and creates a test-only administrator before every run.

## Backend tests

Run all Go tests:

```powershell
cd backend
go test ./...
```

Run the integration tests with detailed output:

```powershell
go test -v ./internal/routes
```

Record the anonymous public-read benchmark against the isolated PostgreSQL database:

```powershell
go test -run '^$' -bench '^BenchmarkAnonymousPublicReads$' -benchmem -benchtime=1s -count=3 ./internal/routes
```

The benchmark seeds 200 published posts, 10 categories, 100 public file records, and representative settings. It sends Cookie-free requests through the real Gin router and PostgreSQL queries for post list/detail, category list, file list, settings, and public search. It is a repeatable regression reference, not a network load test or a production concurrency guarantee. Stop other heavy local work when comparing runs, keep PostgreSQL and hardware stable, and compare several samples rather than one number.

The additional `BenchmarkAnonymousLongBodyReads` uses a rollback-only random schema with 2,400 articles and 1,200 file records. It preserves the original short-body benchmark and adds rare/common search measurements. Both report `response_bytes/op` alongside time and allocations. See [query-analysis.md](query-analysis.md) for isolated query plans and [performance-baseline.md](performance-baseline.md) for measured results. Run database suites, query experiments and benchmarks sequentially.

Full backend validation and coverage:

~~~powershell
go test -race -p 1 -count=1 '-covermode=atomic' '-coverpkg=./...' '-coverprofile=coverage.out' ./...
go vet ./...
go build ./...
go tool cover '-func=coverage.out'
go tool cover '-html=coverage.out' '-o=coverage.html'
~~~

The historical query experiment requires `QUERY_ANALYSIS_OUTPUT` explicitly; the implemented query/index checks use `SEARCH_QUERY_ANALYSIS_OUTPUT`, and the optional GIN maintenance comparison uses `SEARCH_INDEX_EXPERIMENT_OUTPUT`. Each runs only with its explicit output destination and refuses a missing/unsafe database configuration. Its ordinary-suite skip means only the opt-in measurement was not requested; the isolation/rollback integration test still runs whenever `TEST_DB_DSN` is configured.

When `TEST_DB_DSN` is absent, PostgreSQL integration tests are skipped. CI always supplies it, so the integration tests are mandatory there.

## Frontend unit and component tests

Run the deterministic frontend test suite once:

```powershell
cd frontend
npm run test:unit
```

Use watch mode while developing frontend behavior:

```powershell
npm run test:unit:watch
```

Vitest and React Testing Library cover pure data transformations and focused client-component behavior in a `jsdom` environment. Browser-dependent layout, computed styles, file downloads, image loading, navigation, and complete user workflows remain Playwright responsibilities.

Run `npm run test:coverage` to generate HTML, LCOV and Istanbul reports in `frontend/coverage`. See [quality gates](quality-gates.md) for enforced thresholds and [coverage measurements](coverage-baseline.md) for historical comparisons. Browser execution is not included in unit coverage.

## Browser workflow test

From `frontend`, install Chromium and run the suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

Playwright builds the standalone frontend and starts isolated servers on ports `3100` and `18080`; it does not reuse development servers. Tests run with one worker. The desktop `chromium` project runs all applicable workflows; `mobile-chromium` selects `mobile.spec.ts`, `accessibility.spec.ts` and `keyboard.spec.ts` at a 375px viewport. Individual cases also exercise other widths.

For a focused run:

```powershell
npx playwright test accessibility.spec.ts keyboard.spec.ts mobile.spec.ts
```

On failure, inspect `frontend/test-results` and open the retained trace:

```powershell
npx playwright show-trace test-results/<result-directory>/trace.zip
```

## Regression coverage

### API, database and storage

Go integration tests exercise the real router and PostgreSQL: authentication/CSRF, role boundaries, session invalidation, trusted-proxy throttling, public caching, conditional file reads, request logging and redaction, health checks, constraints and atomic writes.

Search checks cover summary-only SQL/JSON, protected article details, exact totals, combined limits, stable ordering, literal wildcards, Unicode, category filters and draft/system-file isolation. Concurrent visibility changes must not split counts from the returned page. Historical backfill and article writes use the same Markdown extractor.

Migration tests cover fixed historical schemas, bounded backfill, unchanged article content/timestamps, extension and permission failures, rollback/retry and concurrent migration locking. The backup drill uses real PostgreSQL 18 `pg_dump`/`pg_restore`, disposable source and `_restore` databases, and uploaded files. It checks checksums, restored indexes/triggers, Links and storage reconciliation. Matching client tools are required when `TEST_DB_DSN` is configured.

File tests cover content/extension mismatches, size limits, safe storage keys, path confinement, symlinks, attachment headers, referenced-file protection, deletion compensation and reconciliation. Browser workflows exercise upload, metadata editing, preview, search and deletion through the actual API.

### Article editing and recovery

Component and browser tests cover direct editor URLs, failed detail reads, retry, versioned saves/publication, duplicate submission, stale responses, two-tab conflicts and session expiry. Conflict review preserves local input and requires an explicit choice against the reviewed server version; a later concurrent update must conflict again.

First-save and document-refresh checks retain the form, fields and Markdown preview through saved-ID adoption and hydration. English/Chinese browser contexts check toolbar locale changes without replacing the editor. Include a development-server browser check when changing this lifecycle: development hydration diagnostics can expose mismatches not reported the same way in production.

Recovery tests use the real IndexedDB adapter with fake-indexeddb for validation, ownership, expiry, bounds, storage denial, queued writes and logout invalidation. Chromium covers reload, browser restart, duplicated tabs, explicit restore/discard/keep, failed cleanup, navigation cancellation and native unload prompts. Restoring a copy must not write an article to the server. See [editor behavior and recovery limits](editor.md).

### Homepage links and dialogs

Links tests cover migration replay, hidden templates, URL and color validation, visibility, collection limits, version conflicts, idempotent create retries and atomic adjacent ordering. Browser checks cover server-rendered lists, failed-read retry, drafts during pending ordering, save/reopen persistence, clamped card geometry, touch/mouse scrolling and keyboard activation.

Dialog tests cover Cancel, Escape, backdrop dismissal, drag-out protection, busy blocking, failed-save retention and focus restoration. Actual exit animations are paused to inspect mounted-but-inactive states and background isolation. The color picker covers dragging, keyboard sliders, invalid HEX recovery, viewport positioning, interrupted dismissal and reduced motion.

### Search and navigation

Unit tests cover URL normalization, independent search section pages, stale responses, cancellation, exhausted-page correction and history metadata. Browser checks exercise all list/search routes through back/forward/reload, delayed requests, empty results, failures and rapid scope changes.

Initial search keeps its loading status visually hidden for screen readers; results enter without a preceding placeholder exit. Later searches retain resolved content while pending, then transition to the new result. Idle scope changes leave the keyword prompt stable. The Posts category field becomes inactive immediately on exit and hides after its transition; reversing an unfinished exit and reduced-motion behavior are checked.

Pagination checks retain outgoing rows until exit completes and prevent nested page animations during scope changes. Content Editor reserves a complete page even on a short last page and recomputes it on resize. Navigation checks use 991 articles/files, deep pages and repeated detail round trips with storage blocked or snapshots expired. This is a functional navigation fixture, not a performance benchmark.

Frame assertions check DOM continuity, opacity, dimensions and scroll position during sidebar, save, refresh and navigation transitions. Sampling accounts for elapsed time and existing animations; screenshots are diagnostic attachments rather than byte-equality assertions. Script-blocked reloads distinguish server rendering from hydration.

## Appearance preferences

Unit and browser tests cover cookie names/values/defaults, rejected persistence, contradictory legacy storage, immediate theme/sidebar updates and server/hydration agreement. Storage denial is simulated at the JavaScript boundary; it does not cover every browser privacy policy.

Date tests use populated article/file fixtures in different browser locales and time zones. They verify the shared site-time formatter in server HTML, hydrated lists, previews, saved timestamps and recovery choices, including invalid inputs and calendar boundaries. See [preferences and date display](preferences.md).

## Mobile and accessibility regression

Chromium checks 320/375/768px layouts, drawer isolation and dismissal, keyboard focus, long-content wrapping and reduced motion. Keyboard workflows cover category management, Markdown controls, resource tabs and saving in both themes. Pointer checkbox interaction suppresses the focus ring while keyboard navigation retains it; text-entry focus shadows and keyboard sliders are checked separately.

axe scans public/admin pages and dialogs; serious or critical violations fail the suite. Full scan results remain in the CI report. Automated checks do not establish complete WCAG conformance. Physical devices, virtual keyboards, screen-reader announcements, Firefox and WebKit require separate validation. See [accessibility](accessibility.md).

## Deployment automation

From the repository root:

```powershell
python -m pip install -r deploy/tests/requirements.txt
python -m unittest discover -s deploy/tests -v
```

Tests cover source CI identity, production-branch/event gates, approval-before-deployment ordering, reviewed artifact integrity and summary privacy. Synthetic sensitive values must stay out of public summaries, artifacts and error output. Go cache configuration checks require the module's existing checksum file.

Fault-injection tests exercise pull/backup/migration/health failures, stale and repeated runs, persistent guards, SSH validation and image retention. The real Compose parser checks release overlays; Linux executes the `flock` test, which is skipped on Windows. Simulated retention checks do not establish real Docker deletion. Registry authentication, GitHub event delivery, environment approvals, SSH and VPS operation require remote validation; see [automatic deployment](automatic-deployment.md).

## Continuous integration

CI runs for pull requests, manual dispatch and pushes to `main`/`master`. An ordinary push to `codex` does not trigger the push workflow. CI, CD and dependency checks use GitHub-hosted Ubuntu 24.04; validate an OS image upgrade before changing that version.

| Job | Checks and artifacts |
| --- | --- |
| Frontend | Lint, unit coverage, quality helpers and production build; coverage retained for 30 days |
| Backend | PostgreSQL integration/race coverage, vet/build, actionlint, real backup/restore, query plans and both benchmarks; reports retained for 30 days |
| E2E | Standalone-server Chromium workflows; available screenshots, videos, traces and HTML/axe reports retained for seven days |
| Containers | Compose model, non-root images, disposable topology, readiness, same-origin routes and private metrics boundary; disposable volumes removed afterward |
| Deployment tests | Release-script, approval, retention and workflow contracts |

All required jobs gate image publication. Image publishing is restricted to eligible production-branch runs; deployment approval is configured on the production environment. Local native checks do not establish remote CI or container success. Benchmark reports have no timing threshold; failed experiments still fail their steps.

## Dependency and workflow checks

From the repository root, run `node --test tools/quality/*.test.mjs`. From `backend`, run `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` to validate workflow syntax and semantics.

The [dependency workflow](dependency-maintenance.md) runs manually and weekly. Ordinary newer versions are informational; audit and execution failures remain failures. Keep the Go toolchain aligned between `backend/go.mod` and the Docker build stage, and verify API, migration, seed and backup/restore commands after backend dependency updates.
