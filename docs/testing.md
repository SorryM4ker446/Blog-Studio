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

Editor URL regressions cover direct saved/new article entry, strict target parsing, retained list conditions, replacing a new draft's URL with its returned ID and ignoring pending saves after history changes article targets. Chromium reloads both draft and published editors, traverses Back/Forward, checks the initial loading HTML, verifies published saves return to the list, reloads a newly saved draft and handles missing article IDs. The fixture includes a search term with spaces to exercise initial URL normalization without losing the router's history state. These checks restore saved server content; unsaved-input recovery is not implied.

Editor save regressions cover duplicate submission, the return-to-list lock during pending writes, draft creation followed by update, retry after failure and late success/error responses after unmount. Sidebar tests resolve refreshes out of order to verify that the newest category snapshot wins. Chromium tests delay writes in both themes, assert that title, summary, Markdown, category and status controls cannot change during saving, compare save/status geometry and colors, and compare expanded-sidebar text, geometry, colors and transforms while a request is pending, after failure and after withdrawing publication. A requestAnimationFrame monitor checks that the original navigation nodes stay attached, visible and fully opaque throughout the save workflow, including publication changes. A detector regression deliberately introduces a one-frame fade and replaces a link with an identical clone to verify that these failures are caught even when the final presentation is unchanged. Baseline capture waits for fonts and existing sidebar animations to settle. Screenshots of each checkpoint remain diagnostic attachments; compressed PNG bytes are not compared for equality because text and badge rasterization can differ after category reordering. Publishing still returns to Content Editor; draft saves remain in the form. Dropdown tests cover an unavailable URL category, clearing its filter, and visible keyboard selection through a long scrollable menu using Home, End and arrow keys. Browser regressions also exercise repeated dropdown toggles, keyboard selection and outside-click dismissal with normal and reduced motion, including inert closed menus and disabled transitions under reduced motion. These assertions supplement the existing DOM-preservation checks.

Run `npm run test:coverage` to measure all production source files and generate HTML, LCOV and JSON summaries in `frontend/coverage`. The [coverage baseline](coverage-baseline.md) fixes the measurement scope, records actual results and distinguishes Go statement coverage from branch coverage. Reporting is enabled; numerical gates have not yet been activated.

## Browser workflow test

Install the Chromium browser once:

```powershell
cd frontend
npx playwright install chromium
```

Run the E2E workflow:

```powershell
npm run test:e2e
```

Playwright starts isolated backend and frontend servers on ports `18080` and `3100`. The browser suite covers the HttpOnly Cookie login flow, server-rendered identity restoration without a hydration loading shell, login-to-home navigation, CSRF-protected mutations, draft creation, public draft isolation, publishing, public visibility, logout-to-home navigation, server-side logout invalidation, and protected-editor redirection. It also exercises the complete uploaded-image lifecycle: choose a real image, provide display metadata, upload and preview it, edit its name and description, verify the updated preview is public in Drive, reference it from a published post, keep deletion retryable after a simulated temporary storage failure, verify deletion is blocked and explained while referenced, confirm the `file_in_use` state disables repeated deletion without changing the dialog or reloading the file list, remove the reference, and then delete the file successfully. File cards, upload controls, metadata fields, preview surfaces, and primary actions are checked in both dark and light themes as part of this workflow. Layout assertions keep the upload icon centered, prevent long names from overlapping actions, preserve the public file name-and-metadata stack, keep post and file edit actions visually identical, and confirm that an outdated backend response remains retryable with an actionable message.

On failure, inspect `frontend/test-results` or open the saved trace:

```powershell
npx playwright show-trace test-results/<result-directory>/trace.zip
```

## Continuous integration

GitHub Actions creates a disposable `blog_db_test` PostgreSQL service. The frontend job runs linting, unit/component tests with coverage, and a production build. The backend job runs race-enabled integration tests with whole-module coverage, explicit vet/build checks, isolated query plans and both read benchmarks. Coverage and backend JSON test results are retained for 30 days, including on failure. The E2E job installs Chromium and runs Playwright; failure screenshots, video, trace, and HTML reports are retained for seven days.

The backend integration suite additionally verifies login and public-search throttling, public/admin cache boundaries, file conditional revalidation, internal metrics without query-value labels, password policy, CSRF rejection, session invalidation, JWT signature/algorithm checks, and the production CORS allowlist.

Data integrity integration coverage verifies pagination and search boundaries, stable API error codes, post validation, slug conflict handling, immutable first-publication timestamps, post-publication edit timestamps and effective timeline ordering, category deletion with `ON DELETE SET NULL`, database check/foreign-key constraints, case-insensitive category uniqueness, missing-resource deletes, and atomic settings validation.

Article read integration tests capture ordinary list SQL to reject body projections, verify body-free public/administrator list and search JSON, preserve body-only matches and hidden URL/image exclusions, and check anonymous/non-administrator/administrator detail access. Public draft isolation and cache policies are asserted for the read split. Vitest tests verify incomplete/mismatched detail rejection, fresh form snapshots, loading/failure without save controls, retry, cancellation and late-response isolation without article writes. The additional Playwright article-read workflow checks body-free Home, All Posts, search and Editor HTML, a failed detail load followed by retry, complete draft editing/saving and unchanged public detail content. Existing Drive, publication, hard-refresh, input and scroll-return workflows remain part of the full browser suite.

File storage coverage verifies strict TXT detection, active or structured content disguised as text, extension/content mismatches, empty and oversized uploads, random storage keys, path confinement, symlink rejection, safe response headers, forced attachment handling, effective-name and description search boundaries, metadata editing without changing original filenames, referenced-file deletion protection, deletion compensation, and read-only missing/orphaned content reports. Browser coverage additionally verifies Drive and advanced-search name precedence, public description isolation, administrator description search, home-to-advanced-search navigation, file preview from search results, and URL-backed query restoration after opening a post and returning from Drive, advanced search, All Posts, or Editor.

Runtime coverage verifies liveness and readiness semantics, dependency timeouts, shutdown readiness, writable-storage probes, request ID validation, route-template access logging, panic recovery, and sensitive structured-log attribute redaction.

Migration integration coverage includes a fixed pre-search SQL fixture, more than two backfill batches, unchanged content/timestamps, an index-build failure with complete rollback and retry, missing-extension failure in a disposable database, and the configured GIN write-maintenance option. It also uses isolated PostgreSQL schemas to verify empty-database setup, registration of an existing schema without data loss, legacy-row normalization, repeated execution, read-only current-version checks, and concurrent lock serialization. Backup integration coverage creates disposable source and `_restore` databases, produces a real `pg_dump` bundle with uploaded content, verifies checksums and archive structure, restores through `pg_restore`, and checks the restored schema, records, content, and storage reconciliation. `pg_dump` and `pg_restore` from PostgreSQL 18 are required when `TEST_DB_DSN` is configured; GitHub Actions installs the matching client tools before running the backend suite.

The backend job retains query-plan JSON and both benchmark text reports for 30 days. Slower measurements remain visible for comparison without a timing threshold; invalid results or a failed experiment still fail the step.

The container job validates the resolved Compose model, including separation between Caddy's fixed trusted address and the dynamic container address pool. It builds the non-root application images and maintenance image, starts PostgreSQL, migration, backend, frontend, and Caddy with disposable secrets and volumes, and probes readiness plus the same-origin `/api` and frontend routes. It also confirms that `/internal/metrics` is not reachable through Caddy. It always removes the disposable volumes afterward. Local Compose execution is not part of the native development validation workflow.

## Search pagination regression

Backend tests cover all scopes, exact post/file/combined totals, combined limits, stable tied timestamps and IDs, metadata/body deduplication, deep empty pages, malformed page/limit errors, literal wildcard characters, Chinese/short terms, case matching, category renames and draft/system-file isolation. A concurrent writer toggles article/file visibility transactionally while readers verify that totals and hydrated pages share one snapshot. Article writes and historical backfill use the same extractor; direct client writes of derived text are rejected.

Vitest covers shared server/browser query parsing, invalid and duplicated URL conditions, preserved query/category/scope on paging and retry, stale successes and failures, unmount, inactive Editor tabs and bounded last-page correction. The browser pagination workflow seeds more than ten matching resources, verifies body-free combined pages and exact counts, restores All Posts/Drive/advanced-search/Editor filters through back/forward/reload, and deletes the last article on a filtered Editor page to verify replace-history correction. Existing identity, preference, hard-refresh, input and scroll workflows run with it.

Query plan assertions exercise the production SQL after incremental bulk insertion through the real extractor, without forcing planner options or manually flushing an index queue. The historical experiment removes the newly installed search field/indexes only inside its rollback-only schema to preserve the original comparison. CI uploads both plan reports along with existing coverage and HTTP benchmark artifacts.
