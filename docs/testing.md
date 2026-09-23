# Automated Testing

Deployment automation tests run with `python -m unittest discover -s deploy/tests -v` and gate image publication alongside the existing CI jobs. They cover deployment failure boundaries, stale/repeated runs, immutable release references, persistent failure guards, server locking, SSH input validation and real Compose overlay parsing. CD gate tests reject failed, fork, PR and non-production source runs; the dispatcher test verifies source CI SHA/sequence rather than CD defaults. Image retention tests simulate keeping three successful commit versions, duplicate SHAs, incomplete releases, protected container/tag/shared-ID references, repeated cleanup, corrupt metadata and deletion failures. These simulations do not establish real Docker deletion or GitHub workflow chaining. See [automatic deployment](automatic-deployment.md) for production setup and validation limits.

Local automation validation (2026-09-22): 14 tests collected, 13 passed and the Linux-only `flock` test skipped on Windows; real Docker Compose configuration parsing, actionlint v1.7.12 and diff checks passed. Docker Desktop's Linux engine and WSL were unavailable, so no containers, SSH connection, GHCR publication, remote CI or VPS deployment were executed locally. The Linux CI deployment-tests job includes the lock test; existing container and application suites remain prerequisites for publishing.

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

Editor URL regressions cover direct saved/new article entry, strict target parsing, retained list conditions, replacing a new draft's URL with its returned ID and ignoring pending saves after history changes article targets. Chromium reloads both draft and published editors, traverses Back/Forward, checks the initial loading HTML, verifies ordinary saves retain the editor and only successful publication returns to the list, reloads a newly saved draft and handles missing article IDs. The fixture includes a search term with spaces to exercise initial URL normalization without losing the router's history state. Those URL checks restore saved server content; the separate recovery workflows below verify unsaved input.

Editor save regressions cover duplicate submission, the return-to-list lock during pending writes, draft creation followed by update, retry after failure and late success/error responses after unmount. Sidebar tests resolve refreshes out of order to verify that the newest category snapshot wins. Chromium tests delay writes in both themes, assert that title, summary, Markdown, category and status controls cannot change during saving, compare save/status geometry and colors, and compare expanded-sidebar text, geometry, colors and transforms while a request is pending, after failure and after withdrawing publication. A requestAnimationFrame monitor checks that the original navigation nodes stay attached, visible and fully opaque throughout the save workflow, including publication changes. A detector regression deliberately introduces a one-frame fade and replaces a link with an identical clone to verify that these failures are caught even when the final presentation is unchanged. Baseline capture brings Save into view after category interaction and waits for fonts and existing sidebar animations to settle, so click-induced scrolling is not misclassified as a button-style change. Screenshots of each checkpoint remain diagnostic attachments; compressed PNG bytes are not compared for equality because text and badge rasterization can differ after category reordering. Publishing still returns to Content Editor; draft saves remain in the form. Dropdown tests cover an unavailable URL category, clearing its filter, and visible keyboard selection through a long scrollable menu using Home, End and arrow keys. Browser regressions also exercise repeated dropdown toggles, keyboard selection and outside-click dismissal with normal and reduced motion, including inert closed menus and disabled transitions under reduced motion. These assertions supplement the existing DOM-preservation checks.

Run `npm run test:coverage` to measure all production source files and generate HTML, LCOV, full Istanbul JSON and JSON summaries in `frontend/coverage`. The [coverage baseline](coverage-baseline.md) fixes the measurement scope, records actual results and distinguishes Go statement coverage from branch coverage. Global and focused numerical gates are enforced; see [quality-gates.md](quality-gates.md) for exact floors and decision coverage.

Sidebar motion regressions retain the same All Posts link and category nodes across collapse/reopen, with hidden controls made inert. Chromium samples component positions through a four-to-three-column home-grid reflow in both themes, checks intermediate movement rather than only endpoints, reverses the sidebar repeatedly, and navigates while motion is active. It also checks reduced-motion behavior, unsubmitted search/editor values, absence of article writes or leave prompts on sidebar toggles, and unchanged article-body dimensions and inner scroll position at the tested desktop width. These are functional continuity checks, not a hardware-independent frame-rate guarantee. Browser position animations are not included in the Vitest coverage report.

Editor detail sizing is sampled throughout sidebar motion: header, fieldset and Markdown textarea dimensions and inner scroll position must stay fixed while the frame moves. Motion samples normalize displacement by elapsed time so delayed frames under build/test load are not mistaken for instantaneous layout jumps. This is not an assertion of a fixed frame rate.

## Appearance preferences

Unit tests cover the shared cookie names, strict values, defaults, one-year lifetime and site-wide scope, plus rejected writes and use without browser globals. Theme, TopBar and sidebar tests check contradictory legacy localStorage, denied storage access/methods, cookie write exceptions, immediate UI updates and category controls. They also verify that hydration does not rewrite the sidebar cookie.

Chromium checks raw server HTML and hydrated theme/sidebar state, delayed application scripts, contradictory old preferences, throwing localStorage getters and methods, normal reload and cache-disabled reload. It checks cookie values and attributes after real clicks, stable defaults for malformed values, and current-page usability when cookie writes throw or are silently ignored. Legacy authentication cleanup and unrelated storage retention are checked separately from appearance persistence. The full suite retains identity, article recovery, navigation cancellation, sidebar motion, editor geometry and scroll-restoration workflows.

Browser denial is simulated at the JavaScript storage boundary; it does not claim coverage of every browser privacy policy or enterprise setting. These tests use the existing Chromium project and standalone deployment build, without adding dependencies or changing CI discovery. See [appearance preferences](preferences.md) for retention and compatibility rules.

Preference workflows visit the ordinary article list and retain their page-error assertions, including when earlier workflows have populated it. Dates use a shared deterministic formatter rather than runtime-default locale or time-zone settings.

Date regressions create and clean up their own published article and uploaded file. Chromium runs with `en-US` / `America/Los_Angeles` and `ar-EG` / `Pacific/Kiritimati`, checking nonempty Home, Posts, Search, Drive, Editor lists and article details against server HTML, exercising theme controls after hydration, and repeating a cache-disabled reload. File preview, saved-editor timestamps and recovery timestamps use the same site time. The tests reject hydration/page errors and check that viewing and restoring leave article timestamps, version and server content unchanged. Unit tests additionally cover equivalent offsets, midnight/year boundaries, leap days, another region's daylight-saving transition, epoch zero and invalid or timezone-less input. The regression does not suppress hydration warnings or defer dates until after mounting. See [date display rules](preferences.md#date-display).

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

Vitest covers shared server/browser query parsing, invalid and duplicated URL conditions, preserved query/category/scope on paging and retry, stale successes and failures, unmount, inactive Editor tabs and bounded last-page correction. The browser pagination workflow seeds more than ten matching resources, verifies the unchanged body-free combined API limit and exact counts, verifies that advanced search renders ten posts plus ten files from separate scoped requests, restores All Posts/Drive/advanced-search/Editor filters through back/forward/reload, and deletes the last article on a filtered Editor page to verify replace-history correction. Advanced-search checks also cover independent section paging, single-scope section/category visibility, legacy page links, per-section exhausted-page correction, server HTML containing file results, and returning from an article to both saved page positions. Existing identity, preference, hard-refresh, input and scroll workflows run with it.

Query plan assertions exercise the production SQL after incremental bulk insertion through the real extractor, without forcing planner options or manually flushing an index queue. The historical experiment removes the newly installed search field/indexes only inside its rollback-only schema to preserve the original comparison. CI uploads both plan reports along with existing coverage and HTTP benchmark artifacts.

## Article versions and publication

Backend integration tests race a save against publication with the same version and require one success and one stable version conflict. Tests cover version validation, action-only status changes, withdrawal without content changes, first-publication timestamps, category-deletion invalidation and concurrent saves, deletion during a save, read failures and rollback when the post-write reload fails. Migration tests cover historical version backfill, failure rollback and retry; the backup drill verifies that restored triggers continue advancing versions.

Editor component and browser tests cover draft creation followed by publication failure and retry, explicit adoption of a newer server snapshot, preservation of unsaved text during withdrawal, local handling of session expiry and two browser tabs competing to save. Existing save/sidebar stability, category dropdown, URL/history, search and file workflows remain enabled. Fixtures create drafts and publish them through the separate endpoint. Coverage reports retain the existing global scope; numerical global gates remain separate quality work.

Article navigation regression opens the actual View article link in the current tab and verifies that both the page Back button and browser Back return to the corresponding editor and offer the unsaved browser copy. Unit tests cover user/article isolation, expiry/clearing, safe matching return URLs and the ordinary no-history fallback. Dark/light-theme save tests hold a successful published save pending and check unchanged button label, dimensions, colors, opacity, original DOM node and sidebar presentation; completion retains the editor URL. Login action screenshots and keyboard Return Home navigation also run in both themes.

Article-view and login-home icon links retain their accessible names and native hover titles while hiding permanent text. The existing dark/light screenshots, same-tab article viewing and keyboard home-navigation checks verify these controls.

## Browser recovery and navigation cancellation

Vitest uses fake-indexeddb to exercise the real IndexedDB adapter: record validation, user/article/new-draft isolation, expiry, malformed data, copy count and byte limits, storage denial, user-generation invalidation and removal markers. Writer tests verify one-second throttling, explicit flush, queued and in-flight cleanup ordering, quota errors and retry. Hook tests cover explicit restore/discard, independent forks, no recovery choices across users, storage failure and cancellation on logout. Navigation tests cover program navigation, clean/busy forms, ordinary links versus downloads/new tabs, original framework state preservation, cancellation before router listeners and session-expiry preservation.

Chromium exercises cancellation and continuation for list, sidebar and browser-history departures, native reload/close prompts, reload recovery, discovery and discard of closed new drafts, cloned sessionStorage ownership, separate tabs, version conflicts after restoring old text, global session expiry, failed versus confirmed logout and storage denial. Requests are observed to prove that local recovery and restore do not send article POST/PUT requests; server content is checked independently. Saving removes the appropriate copies, while a different tab's source remains. The existing full publication, sidebar/button stability, identity, search, scroll, file and login workflows remain enabled. Restored-editor screenshots are retained as diagnostic artifacts.

Themed confirmation is exercised through actual Stay in editor/Leave editor buttons; only refresh and close use Playwright's native dialog events. Dark/light recovery and confirmation screenshots cover explicit multiple-copy choices, initial focus, Tab cycling, Escape cancellation and focus restoration, and restore/discard/leave without server article writes. Unit regressions additionally cover duplicate navigation requests, delayed flush completion after editor changes, preparation failure, session expiry and logout invalidation. A browser-native reload warning remains outside application styling.

A persistent-profile Chromium regression also confirms that an already-written recovery copy of a published article survives closing the editor and restarting the actual browser process. It removes authentication cookies, signs in again without invoking logout, and opens the article's Edit action from the content list. The restored text is checked against unchanged server content. This covers orderly shutdown with a committed copy, not forced termination, a last-second uncommitted write, private browsing, or browser policies that clear site data on exit.

`instrumentation-client.ts` installs the history boundary before React hydration; browser assertions are essential because a wrapper installed later cannot see all router-internal history writes. Browser tests cover Chromium on the native standalone server. Firefox/WebKit, mobile OS termination, browser eviction and remote container execution are not implied by this suite. No local Docker Compose execution is required. The existing CI unit/coverage and complete Playwright jobs automatically discover the added files; fake-indexeddb is a development-only dependency.

## Search pagination presentation

Chromium checks both themes for persistent arrow nodes and unchanged opacity/position while a scope request is delayed, desktop side placement, directional next/previous result motion, reduced-motion behavior and a narrow-screen bottom-row fallback without horizontal overflow. Unit tests verify that pending controls stay mounted, keep their styles and reject duplicate page requests. The complete search workflow retains independent post/file pages, history, refresh and article-return checks.

All Posts, Cloud Drive, both Content Editor tabs and file-only advanced search also have dedicated motion regressions with delayed page responses. They assert that old rows and pagination nodes remain visible while controls reject repeated clicks, that All Posts, Cloud Drive and Content Editor keep arrows beside the bottom page numbers while advanced search uses desktop side arrows, with a bottom row on narrow screens and no horizontal overflow, and that next/previous and history transitions preserve the search input. Reduced-motion checks require direct content updates without new result animations. Existing real-API workflows continue to cover reload, article return, file preview and download behavior.

Advanced-search category regressions verify that only Posts scope renders the label and dropdown, including server entry with a stale category in all scope. Browser tests inspect the entry animation keyframes, reduced-motion fallback, category clearing when leaving Posts, and history restoration of the previously selected category. Query helpers additionally assert that hidden categories cannot constrain all/files searches.

Scope-transition regressions verify distinct upward exit and downward-offset entrance keyframes, delayed responses without dimming or empty replacement, rapid scope selection with a late response, history restoration, recoverable request errors, and reduced-motion fallback. Unit tests exercise obsolete animation callbacks after cancellation/unmount, errors carrying an older scope, browsers without the animation API and immediate ordinary page updates. The result area is inert only while its displayed scope differs from the selected scope.

Pagination motion checks require outgoing cards to fade to zero before the incoming tree starts from zero opacity. Content Editor checks also compare the reserved viewport height before and after paging from ten cards to one, so a short last page cannot collapse the grid. Both editor resource tabs, reduced motion and history navigation remain covered.

Browser checks pause the actual outgoing page animation and require the old ten rows to remain mounted with pagination blocked until exit completion. Width changes must recompute Content Editor's complete-page reservation using the responsive column count. Scope changes from a later page must not trigger an additional nested page animation.

## Mobile and accessibility regression

`npm run test:e2e` runs the desktop `chromium` project plus `mobile-chromium`, still with one worker. The mobile project selects only `mobile.spec.ts`, `accessibility.spec.ts` and `keyboard.spec.ts`; its fixtures log in and create/clean their own resources instead of depending on another project's execution. The existing safe test database and production-build server setup are unchanged.

Checks cover 320/375/768px layouts, modal drawer keyboard/backdrop/Escape behavior, desktop Cookie isolation, cancelled/accepted editor departures, route focus and reduced motion. Populated long article/file fixtures exercise wrapping and local scroll regions. Both themes run keyboard category creation/rename/delete, Markdown heading/table controls, Save and resource tabs. axe scans public/admin pages, file preview/upload and confirmation surfaces, with no rule exclusions; serious/critical violations fail the test. The CI Playwright report now uploads on success as well as failure and includes full axe JSON attachments. This dev-only dependency requires no production service, environment variable or image change.

For a targeted run use `npx playwright test accessibility.spec.ts keyboard.spec.ts mobile.spec.ts`. Continue to run the complete suite before acceptance to cover identity/preference hydration, delayed requests, editor recovery, publication and scroll/history behavior. Manual real-device and screen-reader checks remain distinct from automated Chromium evidence; see [mobile layout and keyboard access](accessibility.md).

Search-entry browser regressions cover first results, retained content during delayed keyword requests, replacement and empty results without nested page animations. Sidebar regressions pause category expansion at an intermediate height, reverse it with Less and check hidden-link focus exclusion. Both flows run with normal and reduced motion.

Initial-search feedback checks hold the response until the delayed text status is visible, reject skeleton rows, and verify first results have an entrance without a preceding exit. Unit tests cover early completion/timer cleanup and immediate first-result presentation; keyword replacement still requires exit/entrance.

Sidebar selection regression follows client links and browser back/forward, checks a single current navigation entry, and confirms shared highlight styling. Core-page accessibility fixtures also check login, public/admin sections and article detail; mobile navigation checks the current destination after its drawer reopens. Category snapshots capture the matching left-aligned More/Less controls in both themes; geometry checks require both labels to align with the category text. Home navigation checks retain current-page semantics while requiring no selected class or persistent background.

Article-to-list return checks create and open a real published article from the second page, delay list revalidation, and require the restored page to stay selected without replaying pagination motion. Both lists retain whole-page entrance, and explicit paging after returning still animates. Content Editor's deterministic complete-page height must survive the round trip at the same viewport width.

Return snapshots are transient list data, separate from editor recovery copies. Unit checks cover user isolation, five-minute expiry, bounded eviction, rejected late writes after cleanup, and page changes with reused React content. Sidebar source checks cover category/editor entry, other-module navigation, history traversal, refresh, and invalid history metadata.

Pagination restoration checks pages 7, 50, and 100 of a real 991-article and 991-file dataset created through authenticated APIs in the isolated test environment. This tests actual routes and list geometry, in addition to the ellipsis and boundary unit tests. It is a functional navigation fixture, not a large-dataset performance benchmark.

Keyboard navigation waits for the canonical `/editor?tab=posts` URL and the selected Posts tab before continuing. An exact `/editor` assertion races with query normalization and can fail on CI even when navigation succeeds. Desktop/mobile and dark/light keyboard workflows remain enabled without increasing retries or timeouts.

Category rename regressions also require the menu to remain open after focus returns to its trigger. A unit test holds the field disabled across completion and verifies subsequent Tab navigation to Rename and Delete; browser keyboard checks cover both themes and viewport projects.

Editor layout regressions reload a short page in both resource tabs and require the same complete-page height. Narrow views recompute the row count and keep the full-page reservation. Unit checks reject obsolete layout metadata and verify its removal; measured dimensions are no longer an input to layout.

Silent-refresh browser checks hold all Next.js JavaScript chunks during reload so assertions inspect server-rendered UI before hydration. Real article fixtures cover home, editor, search, All Posts and category sources. Editor checks compare the short page's height, controls and scroll before and after hydration, then resize while scripts are still blocked. Refresh does not start route or pagination motion. Page errors and hydration errors remain failures.

## Navigation without return snapshots

`navigation-stability.spec.ts` creates and cleans 991 published articles and 991 public files through the existing API, with at most 20 concurrent setup requests. The guarded Playwright database setup remains unchanged. Both editor resource tabs are entered directly on pages 7, 50 and 100 with storage methods throwing, at desktop and mobile widths. Script-blocked first entry checks the short last page before hydration and records frames through a real theme interaction after takeover.

All Posts and Content Editor each perform 50 consecutive detail round trips from a ten-row middle page, rotating through the articles. Frame samples reject other page numbers, height changes and pagination-animation replay; route entrances remain enabled. Another workflow visits 25 distinct page keys and traverses back to an early target. Six-minute expiry uses the browser's controlled clock rather than an actual wait. Delayed and failed revalidation verify the cold target page, editor geometry, absence of old rows and successful retry. Frame JSON and deep-page screenshots are saved with the normal Playwright artifacts and uploaded by the existing CI job.

Focused units cover history entry separation for repeated URLs, query normalization, preservation of framework/guard state, blocked storage, malformed metadata, obsolete layout removal, session/account invalidation and delayed-scroll cancellation/cleanup. The complete browser suite retains independent search pagination, rapid/out-of-order requests, last-page deletion, identity and theme hydration, source highlights, save locks, recovery copies, cancellation, mobile drawers, keyboard workflows and reduced motion.

A browser history check pushes the same URL twice with different offsets and verifies Back and Forward with browser storage blocked. A focused regression retains the recorded source offset when Next.js commits its history update after replacing the page DOM; that commit must not overwrite the source using the destination's scroll position.

These are local native-server Chromium checks, including API and PostgreSQL behavior through the existing test servers. They do not imply remote CI/container execution, Firefox/WebKit behavior, physical mobile-device testing or a production load benchmark. No local Docker Compose run is required.


## Dependency and workflow checks

Run `node --test tools/quality/*.test.mjs` from the repository root to validate the gate helpers, including their rejection paths. From `backend`, run `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` to check workflow syntax and semantics without invoking Docker. CI uses the same pinned validator. The [dependency maintenance workflow](dependency-maintenance.md) checks security and available versions manually and weekly; ordinary newer versions are informational, while check failures remain failures.

The backend toolchain is Go 1.26.8 in the module, CI and Docker build stage. Test/build the server, migration, seed and backup/restore commands after dependency updates. The existing PostgreSQL 18 test database, fixed historical migration fixtures and real pg_dump/pg_restore drill remain mandatory for final backend acceptance. Container builds and Compose topology are validated separately in GitHub Actions.

The September 15, 2026 local acceptance run passed lint, 273 unit/coverage tests, all six gate-helper tests, locked installation, audit and production build. Node 22.23.2 and 24.9.0 produced identical coverage; the independent build used Node 22.23.2. The full standalone-server E2E run used Node 24.9.0 and Go 1.26.8: 65 desktop and seven mobile Chromium cases passed with zero retries. It retained accessibility, keyboard, hydration/frame, cache-independent navigation, recovery, publication and failure-path assertions.

Resource-filter regressions seed real posts, categories and uploaded files, hold search responses, pause outgoing animations, and verify matching-to-empty, empty-to-empty and empty-to-matching results on Editor Posts/Files, All Posts and Cloud Drive. Editor category and resource changes check result entrance and the actual CSS indicator transition; mobile reduced motion updates without animations. A first-save observer verifies that the title, Markdown editor and Save button remain mounted and that recovery checking does not move the form header. The observer starts after bringing Save into view and completing the initial entrance, separating application movement from the browser's normal click scrolling. These tests retain the existing full navigation, pagination, recovery and publication matrix.

The first-save regression also samples animation frames and effective ancestor opacity for both direct new-draft URLs and the list's New Post button. A unit regression deliberately holds the router's search parameters behind native history to exercise the saved-ID handoff regardless of scheduling speed. The observed reset reproduced in Next development mode even when the production test passed, so a development-mode run is relevant when changing this handoff. Document-refresh tests hold JavaScript, verify the server-rendered title and Markdown input/preview, then inspect node identity, content, geometry and opacity through hydration. Returning to the list must run exactly one entrance. Resource observers reject intermediate Loading labels when a previously resolved result is empty. Screenshots and frame attachments use Playwright's test output paths for local and CI portability.

Editor document regressions run in both `en-US` and `zh-CN` browser contexts. With JavaScript held, the toolbar must retain the server's default attributes; after hydration it must expose the browser's supported language while keeping the original form and body. Both console errors and page errors are checked. Include the development-mode run when changing locale initialization: React's detailed attribute-mismatch warning is not equivalent to its production error behavior.

Refresh frames also check that the category-add button retains full opacity from the disabled server-rendered form through recovery completion. The control must be disabled before hydration and enabled afterward. Dark/light save regressions compare its complete presentation while a write is held and after a failed write unlocks the form, retaining the disabled-state assertions.

Complete Go atomic race coverage, vet, build, actual PostgreSQL migrations/backup restore, both query-plan suites and three-sample before/after read benchmarks passed. All five deployment commands also cross-compiled for Linux amd64 with CGO disabled and the Docker build flags. Windows skipped the filesystem symlink test because the account could not create symbolic links; its Linux CI execution remains required. The optional alternative-GIN-queue experiment was not rerun; production query plans include their existing index write comparisons. None of these local results establish remote CI, execution of Linux binaries/containers, physical-device behavior or production capacity.


Homepage Links regressions cover hidden migration templates and migration replay, administrator/CSRF boundaries, idempotent create replay, URL validation, visibility, version conflicts and transactional adjacent ordering. `homepage-links.spec.ts` exercises the management dialog, live preview, search, final-page deletion, direct Cancel/Escape dismissal, server-rendered counts and lists without JavaScript, resolved list/count reuse without tab-triggered reads, stable New Link appearance during delayed ordering, editable drafts with blocked submission until ordering completes, conflict-driven list invalidation, duplicate reorder suppression without grid displacement, shared empty states and shared resource transitions, mouse dragging without unintended navigation, ordinary external clicks, touch scrolling and the compact four-column homepage row in both themes plus mobile/reduced-motion layouts. Links test cleanup is included in the isolated database reset. These tests use the existing CI jobs and require no additional browser or database dependencies.


`editor-actions.spec.ts` checks matching toolbar sizing, search-icon submission, deletion entrance and exit frames, Cancel/Escape/backdrop dismissal, background isolation during exit, failure/retry and focus restoration in both themes and mobile layouts. Exit animations are paused through the browser animation API to verify their intermediate state without timing sleeps. Unit coverage includes all four deletion resource types, obsolete exit cancellation and reduced motion. Existing category keyboard and Links CRUD regressions continue to exercise the shared dialog.

`editor-dialogs.spec.ts` verifies Links/Files dialog close, Cancel, Escape, backdrop dismissal, drag-out protection, focus restoration, busy blocking, failed-save retry, persistence and successful-save exit. Real panel exit animations are paused to assert intermediate background isolation and stable saving controls. It checks dark/light themes, mobile overflow/accessibility, and reduced motion. `EditorSelect.test.tsx` verifies that hovering or keyboard-highlighting an unselected category cannot change the rename/delete target. `ModalSurface.test.tsx` covers exit completion, interrupted entrance, stale callbacks after unmount and reduced motion.

`editor-presentation.spec.ts` checks equal category action dimensions, selected-option exit intermediate frames, focus, themed action colors, and desktop/mobile accessibility. Recovery tests verify that Keep copies and continue unlocks the saved version, retains the previous same-tab browser copy through a later save, and offers it again after reload without writing recovered content to the server.

`editor-conflict.spec.ts` checks dark/light conflict review at desktop and mobile sizes, retry after a failed latest-version read, read-only previews, preservation of unsaved input during review, and explicit replacement unlocking the form.

Recovery cleanup regressions cover keeping unselected same-tab alternatives after restoring/saving one copy, preserving the recovery prompt after a failed storage deletion, retrying that deletion, and ignoring a continue action during discovery or after navigation/logout. Links dialog unit tests cover field validation, failed-save retention, stable create request identity on retry, hidden destinations and saving locks. The database backup/restore integration fixture includes a visible homepage link and checks its destination, presentation, ordering, version and replay identity after restoration.

CI discovers the added Vitest, Playwright and Go tests through its existing commands; no workflow or threshold changes are required. CI runs for pull requests, manual dispatch and pushes to main/master, not an ordinary push to codex. Local native checks do not establish that GitHub Actions or the Linux container job has passed. The deployment still requires the Links migration; the browser recovery fixes require only rebuilding the frontend, with no recovery storage format change.

Validation on 2026-09-22: 311 frontend unit tests passed with the unchanged global and critical-path coverage gates (recovery hook branches 92.59%, recovery store branches 93.10%, article save/publication branches 90.67%). Complete Go race tests with all-package atomic coverage passed; merged statement coverage was 70.93% against 68%, and article mutation coverage was 96.1% against 90%. The real PostgreSQL restore fixture, including Links, passed. Type checking, ESLint, production builds, Go vet/build, quality-script tests, actionlint and diff whitespace checks passed locally.

The complete Playwright run executed 103 cases: 99 passed initially. Four failures identified an obsolete all-same-tab-copy cleanup assertion, a light Save hover/disabled color mismatch, and two sidebar tests still targeting removed homepage static cards. Cleanup now asserts exact retained copy IDs, Save retains its color during writes, and sidebar tests provision database-backed Links and verify continuous single-row positioning. All five focused reruns passed, covering those four failures plus dark Save stability; the entire 103-case suite was not rerun after these corrections. No coverage threshold, timeout or retry count was relaxed. Docker Desktop's Linux engine was unavailable, so no local container-topology run was completed. Remote GitHub Actions and production deployment were not run.


### Explicit conflict resolution validation (2026-09-22)

The article conflict review now supports retaining local fields against the explicitly reviewed server version, without saving automatically or bypassing version checks. EditorPageClient and recovery unit suites passed (42 tests). The dark/light conflict browser cases passed (2 tests), including failed preview reads and retry, read-only comparison, mobile layout/accessibility, keeping local edits, a second concurrent write rejecting the reviewed version, successful save after renewed review, and discarding edits in favor of the server. TypeScript, ESLint and the browser production build passed. The renamed review button is synchronized in publication browser tests; that publication/stale-tab browser case also passed (1 test). No backend API, database migration, configuration or CI workflow changes are needed for this frontend behavior; existing CI discovery includes these tests.

Refresh appearance regression: the dark/light conflict browser cases hold the refresh response pending and verify that both resolution buttons remain disabled while their opacity, colors, borders and dimensions match the idle state, then verify they become enabled with the same appearance. Both cases passed after limiting the dimmed loading style to the refresh toolbar; the production build, targeted ESLint and diff checks passed. No deployment or CI configuration changes are required.

Light feedback buttons: shared leave-confirmation and version-review primary actions now use the existing blue/white editor palette in light mode, including the existing primary hover token; dark styling is unchanged. Four dark/light conflict and recovery/leave browser cases passed, with explicit light primary color assertions and the refresh-disabled appearance regression retained. Production build and targeted ESLint passed. This CSS-only theme adjustment needs no deployment or CI changes.

Login proxy regressions exercise the real router and isolated PostgreSQL database with IPv4/IPv6 trusted peers, a trusted forwarding chain, independent client budgets, cross-username blocking, spoofed headers from untrusted callers, missing/malformed forwarding data and successful-login reset. Links manager unit tests cover aborted reads, failed-read retry, write-failure invalidation, new drafts during pending writes, collection limits and account remounts. Existing CI commands discover these tests; no schema, environment-variable or deployment topology changes are required. Proxy headers are simulated at the HTTP boundary locally; this is not production Caddy validation.

Links card layout regressions compare card dimensions and description/destination/action offsets for empty, short, maximum-length Latin/Chinese and unbroken text, including long URLs. Dark/light Chromium cases cover 1920px desktop and 375px mobile layouts, homepage cards and live-preview height stability. Measurements wait for dialog entrance animations to finish. Existing Playwright CI discovers these cases without workflow or dependency changes.

Custom link colors are covered by PostgreSQL migration tests upgrading the preceding schema, preserving presets, accepting HEX colors and rejecting invalid values, plus API tests for normalized writes, idempotent retries, updates and public/admin reads. Homepage Links browser tests exercise floating panel positioning without dialog resize, outside dismissal, reduced motion, pointer dragging, hue keyboard adjustment, invalid HEX recovery, Escape/focus restoration, mobile overflow, custom color preview, save/reopen/homepage persistence and unobstructed card reading without hover tooltips; full descriptions remain available through Edit.
Link save stability tests simulate HTTP 400 failures and delayed retries in both themes, comparing dialog/button geometry and capturing animation frames to detect overlay fades or position changes. These simulated failures do not replace real API persistence tests.
Color picker dismissal checks pause the exit animation to verify that the popover remains mounted but inert, restores focus to Custom, and unmounts after completion; reduced-motion dismissal remains immediate.
Deployment approval tests verify summary generation from real-format CI metadata, exact image references, migration registry parsing, PR lookup/no-match/failure behavior, checksum and source-identity enforcement, and upload-to-SSH manifest consistency. Workflow checks keep summary preparation outside production approval and gate deployment on its successful artifact upload. The existing deployment-tests CI job discovers these tests; live GitHub environment approval and VPS execution still require remote validation.
Approval privacy regressions inject synthetic private values into environment variables, event/commit/author fields and unused image metadata, then assert they are absent from the summary, manifest, step outputs and logs. Failure-path tests verify generic diagnostics without payloads or tracebacks, and workflow checks constrain artifact upload to the two intended public release files.
