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

Editor URL regressions cover direct saved/new article entry, strict target parsing, retained list conditions, replacing a new draft's URL with its returned ID and ignoring pending saves after history changes article targets. Chromium reloads both draft and published editors, traverses Back/Forward, checks the initial loading HTML, verifies ordinary saves retain the editor and only successful publication returns to the list, reloads a newly saved draft and handles missing article IDs. The fixture includes a search term with spaces to exercise initial URL normalization without losing the router's history state. Those URL checks restore saved server content; the separate recovery workflows below verify unsaved input.

Editor save regressions cover duplicate submission, the return-to-list lock during pending writes, draft creation followed by update, retry after failure and late success/error responses after unmount. Sidebar tests resolve refreshes out of order to verify that the newest category snapshot wins. Chromium tests delay writes in both themes, assert that title, summary, Markdown, category and status controls cannot change during saving, compare save/status geometry and colors, and compare expanded-sidebar text, geometry, colors and transforms while a request is pending, after failure and after withdrawing publication. A requestAnimationFrame monitor checks that the original navigation nodes stay attached, visible and fully opaque throughout the save workflow, including publication changes. A detector regression deliberately introduces a one-frame fade and replaces a link with an identical clone to verify that these failures are caught even when the final presentation is unchanged. Baseline capture brings Save into view after category interaction and waits for fonts and existing sidebar animations to settle, so click-induced scrolling is not misclassified as a button-style change. Screenshots of each checkpoint remain diagnostic attachments; compressed PNG bytes are not compared for equality because text and badge rasterization can differ after category reordering. Publishing still returns to Content Editor; draft saves remain in the form. Dropdown tests cover an unavailable URL category, clearing its filter, and visible keyboard selection through a long scrollable menu using Home, End and arrow keys. Browser regressions also exercise repeated dropdown toggles, keyboard selection and outside-click dismissal with normal and reduced motion, including inert closed menus and disabled transitions under reduced motion. These assertions supplement the existing DOM-preservation checks.

Run `npm run test:coverage` to measure all production source files and generate HTML, LCOV and JSON summaries in `frontend/coverage`. The [coverage baseline](coverage-baseline.md) fixes the measurement scope, records actual results and distinguishes Go statement coverage from branch coverage. Reporting is enabled; numerical gates have not yet been activated.

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

Browser checks pause the actual outgoing page animation and require the old ten rows to remain mounted with pagination blocked until exit completion. Width changes must release Content Editor's previous height reservation. Scope changes from a later page must not trigger an additional nested page animation.

## Mobile and accessibility regression

`npm run test:e2e` runs the desktop `chromium` project plus `mobile-chromium`, still with one worker. The mobile project selects only `mobile.spec.ts`, `accessibility.spec.ts` and `keyboard.spec.ts`; its fixtures log in and create/clean their own resources instead of depending on another project's execution. The existing safe test database and production-build server setup are unchanged.

Checks cover 320/375/768px layouts, modal drawer keyboard/backdrop/Escape behavior, desktop Cookie isolation, cancelled/accepted editor departures, route focus and reduced motion. Populated long article/file fixtures exercise wrapping and local scroll regions. Both themes run keyboard category creation/rename/delete, Markdown heading/table controls, Save and resource tabs. axe scans public/admin pages, file preview/upload and confirmation surfaces, with no rule exclusions; serious/critical violations fail the test. The CI Playwright report now uploads on success as well as failure and includes full axe JSON attachments. This dev-only dependency requires no production service, environment variable or image change.

For a targeted run use `npx playwright test accessibility.spec.ts keyboard.spec.ts mobile.spec.ts`. Continue to run the complete suite before acceptance to cover identity/preference hydration, delayed requests, editor recovery, publication and scroll/history behavior. Manual real-device and screen-reader checks remain distinct from automated Chromium evidence; see [mobile layout and keyboard access](accessibility.md).

Search-entry browser regressions cover first results, retained content during delayed keyword requests, replacement and empty results without nested page animations. Sidebar regressions pause category expansion at an intermediate height, reverse it with Less and check hidden-link focus exclusion. Both flows run with normal and reduced motion.

Initial-search feedback checks hold the response until the delayed text status is visible, reject skeleton rows, and verify first results have an entrance without a preceding exit. Unit tests cover early completion/timer cleanup and immediate first-result presentation; keyword replacement still requires exit/entrance.

Sidebar selection regression follows client links and browser back/forward, checks a single current navigation entry, and confirms shared highlight styling. Core-page accessibility fixtures also check login, public/admin sections and article detail; mobile navigation checks the current destination after its drawer reopens. Category snapshots capture the matching left-aligned More/Less controls in both themes; geometry checks require both labels to align with the category text. Home navigation checks retain current-page semantics while requiring no selected class or persistent background.

Article-to-list return checks create and open a real published article from the second page, delay list revalidation, and require the restored page to stay selected without replaying pagination motion. Both lists retain whole-page entrance, and explicit paging after returning still animates. Content Editor's reserved height must survive the round trip at the same viewport width.

Return snapshots are transient list data, separate from editor recovery copies. Unit checks cover user isolation, five-minute expiry, bounded eviction, rejected late writes after cleanup, and page changes with reused React content. Sidebar source checks cover category/editor entry, other-module navigation, history traversal, refresh, and invalid history metadata.

Pagination restoration also checks pages 7, 50, and 100 of a 100-page result set, including ellipsis limits and previous/next boundaries. The eleven-article browser fixture targets a short final page; it is not a pagination limit or a large-dataset performance benchmark.

Keyboard navigation waits for the canonical `/editor?tab=posts` URL and the selected Posts tab before continuing. An exact `/editor` assertion races with query normalization and can fail on CI even when navigation succeeds. Desktop/mobile and dark/light keyboard workflows remain enabled without increasing retries or timeouts.

Category rename regressions also require the menu to remain open after focus returns to its trigger. A unit test holds the field disabled across completion and verifies subsequent Tab navigation to Rename and Delete; browser keyboard checks cover both themes and viewport projects.

Editor layout regressions reload the short second page in both resource tabs and require the same reserved height before testing narrower-view remeasurement. Unit tests reload the layout module after the data snapshot lifetime, validate bounded/versioned geometry, exercise corrupt/blocked/full storage, and reject late resize writes after logout cleanup.

Silent-refresh browser checks hold all Next.js JavaScript chunks during reload so assertions inspect the server-rendered UI before hydration. Real article fixtures cover home, editor, search, All Posts, and category sources; a real eleven-article editor result verifies the short second page's reserved height, page-control position, scroll offset, and absence of refresh entrance motion. The same test changes viewport width while hydration is still blocked to reject obsolete geometry. After releasing scripts, it checks unchanged positions and no browser or hydration errors. Unit checks cover synchronous exit scroll recording, reload restoration, malformed bootstrap metadata, storage denial, unsupported formats, and cleanup of initial layout rules.
