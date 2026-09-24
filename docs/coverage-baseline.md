# Coverage Baseline

Measured on 2026-09-06 before changing application behavior, from revision `2ecefe6` plus coverage-reporting configuration. The frontend suite at that baseline had 25 files and 89 passing tests. PostgreSQL integration, migration and real backup/restore tests ran with native PostgreSQL 18.3 tools.

| Metric | Covered / total | Baseline | Proposed future global floor |
| --- | ---: | ---: | ---: |
| Vitest statements | 1,119 / 2,171 | 51.54% | 49% |
| Vitest branches | 981 / 2,025 | 48.44% | 46% |
| Vitest functions | 225 / 453 | 49.66% | 47% |
| Vitest lines | 1,083 / 1,999 | 54.17% | 52% |
| Go statements | 1,657 / 2,466 | 67.2% | 65% |

These are historical baseline measurements and the original proposed floors. Current enforced floors and their measurement rationale are documented in [quality-gates.md](quality-gates.md); each dated section describes that historical measurement, not current gate status. Do not lower a floor or exclude a difficult file to hide a regression. Time-based benchmark thresholds are independent of coverage and remain disabled.

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

## Search pagination regression measurement

Measured on 2026-09-07 after normalized search, database pagination and shared URL state, with the same whole-source scope. The complete Go race suite passed, including native extension/privilege failures, historical backfill, concurrent search snapshots and real backup/restore. The frontend has 128 passing tests in 27 files, and all five desktop Chromium workflows pass.

| Metric | Covered / total | Result |
| --- | ---: | ---: |
| Vitest statements | 1,062 / 1,903 | 55.80% |
| Vitest branches | 1,000 / 1,837 | 54.43% |
| Vitest functions | 251 / 466 | 53.86% |
| Vitest lines | 1,002 / 1,746 | 57.38% |
| Go statements | 1,784 / 2,581 | 69.1% |

Shared URL parsing has 98.24% branch coverage (56/57); the resource page controller has 100% (30/30). Backend search has 95% statement coverage (38/40), and Markdown search extraction has 98.33% (59/60), exceeding the proposed focused 90% targets. The remaining search reader branches handle impossible-to-serialize database JSON defensively. Tests cover database failure, literal/collation matching, pagination limits, visibility, concurrent writes, retry, cancellation, inactive tabs and stale responses. Go does not report a branch percentage.

The removal of duplicated client list/request state reduces the frontend denominator; no production file was excluded. Aggregate Go profiles must merge duplicate block locations across test binaries before counting, as `go tool cover` does. Windows retains the existing symlink privilege skip. The three opt-in plan/maintenance tools are run separately from the ordinary suite. Global and focused numerical CI gates remain planned quality work; this change records real measurements and checks against the proposed floors without claiming those gates are already enforced.

## Fixed measurement scope

`npm run test:coverage` uses Vitest/V8 4.1.11 and includes all `src/**/*.{ts,tsx}`, excluding only test files, test setup and declaration files. Reports in `frontend/coverage` include text, HTML, LCOV, JSON summary and full Istanbul JSON. Untested production files remain in the denominator. Keep the Vitest coverage provider version aligned with Vitest on upgrades.

Async server components, browser layout, hydration and native navigation still require Playwright. The Next.js testing guide shipped at `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` recommends E2E for async components. Their source is not silently removed from this global baseline, and Playwright execution is not merged into V8 unit coverage.

Go uses `-coverpkg=./...` so routes exercising handlers contribute to the handler coverage. Use the aggregate `go tool cover -func` result, not the average of package output. All module packages, including command entrypoints and test utility production files, remain included. The profile uses atomic mode with the race detector. HTML, profile, function summary and JSON test events are uploaded by CI.

Go's native metric is **statement/block coverage**, not branch coverage. The recommended new-search and publication gate is at least 90% statement coverage in focused logic plus explicit tests for every decision outcome, including rejection, retries and conflicts. This does not provide a numeric Go branch percentage. If numeric Go branch coverage is required, evaluate a separate instrumenter and its race/Windows/Linux compatibility before setting that gate.

For new frontend search, recovery-copy and publication logic, target at least 90% branch coverage in focused modules in addition to the global floors. The enforced scopes are listed in [quality-gates.md](quality-gates.md); scheduled checks are described in [dependency-maintenance.md](dependency-maintenance.md).

## Reproduce

From `frontend`:

~~~powershell
npm run test:coverage
~~~

From `backend`, with `TEST_DB_DSN` already configured for a disposable database ending in `_test` and matching PostgreSQL tools on PATH:

~~~powershell
go test -race -p 1 -count=1 '-covermode=atomic' '-coverpkg=./...' '-coverprofile=coverage.out' -json ./... | Tee-Object test-results.json
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
go tool cover '-func=coverage.out' | Set-Content coverage-summary.txt
go tool cover '-html=coverage.out' '-o=coverage.html'
~~~

Quoting dotted Go flags avoids PowerShell argument parsing surprises. Reports are ignored by Git and Docker build contexts. CI retains coverage and backend test artifacts for 30 days even when a test fails; incomplete reports from failed runs do not establish a passing baseline.

## Article editing measurement

The September 9, 2026 passing run retained the same full-source measurement scope. Vitest measured statements 58.92% (1211/2055), branches 55.91% (1120/2003), functions 56.99% and lines 60.11%, with 154 passing tests. The snapshot/dirty-state helper reached 100% on all four metrics; EditorPageClient as a whole remains at 53.55% branch coverage, so this does not establish a 90% publication-flow branch gate.

Go aggregate statement coverage was 70.7%; the shared versioned article mutation function measured 96.1% and the version migration 100%. Integration tests also exercise concurrent save/publication, category deletion, rollback, validation and stale versions. Numerical CI thresholds are still pending; browser tests are not included in either coverage percentage.

The subsequent same-tab article viewing and action-control update passed 160 unit tests with the same measurement scope: statements 59.35%, branches 57.04%, functions 57.77% and lines 60.47%. The in-memory editor viewing helper measured 100% branch coverage and BackButton 90%; these figures do not enable or replace the pending global CI thresholds.

## Browser recovery measurement

The September 12, 2026 run passed 182 tests in 34 files while retaining the full production-source measurement scope: statements 64.09%, branches 59.58%, functions 61.97% and lines 64.1%. The IndexedDB adapter and writer measured 90.8% branch coverage; the navigation boundary measured 82.53%, the recovery hook 75.34%, and the guarded router wrapper 100%. Web Locks, native unload dialogs and full router/history integration are additionally exercised by Chromium, whose results are not counted in Vitest coverage. The former memory-only viewing handoff has been removed. Numerical global gates and the remaining focused-module branch targets are still separate quality work; these results do not claim that every new module has reached 90% branch coverage.

The subsequent sidebar-motion update passed 183 tests in 34 files: statements 62.46% (1646/2635), branches 58.84% (1394/2369), functions 61.11% (374/612), and lines 62.58% (1400/2237). The new browser geometry/animation module remains in the denominator and is exercised through Chromium, not jsdom; its addition lowers aggregate unit coverage. The complete Chromium suite passed 22 workflows. No coverage exclusion or numerical gate was added for this change.


The themed recovery/leave-confirmation and stable editor-width update passed 187 tests in 34 files with unchanged measurement scope: statements 62.69% (1726/2753), branches 58.37% (1422/2436), functions 61.04% (387/634), and lines 62.96% (1452/2306). Asynchronous continuation tests cover cancellation during flush, duplicate requests and stale completion invalidation. The native modal, theme rendering, keyboard focus and editor geometry are additionally exercised by the complete 24-workflow Chromium suite, whose coverage is not merged into Vitest. Numerical gates remain pending.

## Appearance preference measurement

The cookie preference update passed 199 tests in 35 files on September 12, 2026, retaining the same full-source scope: statements 62.83% (1731/2755), branches 58.7% (1436/2446), functions 61.19% (388/634), and lines 63.14% (1458/2309). The shared preference-cookie module reached 100% across all four metrics. Server HTML, hydration, reloads and browser storage denial are additionally verified in Chromium and are not merged into these percentages. No coverage exclusions or numerical gates were added.

The subsequent deterministic date-display fix passed 203 tests in 36 files with the same measurement scope: statements 62.95% (1740/2764), branches 58.89% (1447/2457), functions 61.44% (392/638), and lines 63.23% (1464/2315). Both the date-display and preference-cookie modules reached 100% across all four metrics. Cross-locale/time-zone browser regressions use populated article and file pages; they are not counted in these unit coverage totals.

## Independent search section measurement

The grouped advanced-search update passed 218 tests in 39 files with unchanged full-source measurement scope: statements 63.75% (1815/2847), branches 60.46% (1523/2519), functions 62.12% (410/660), and lines 64.06% (1526/2382). The search navigation hook measured 93.54% branch coverage. Tests cover separate section requests/pages, excluded scopes, legacy links, stale responses, retry and exhausted-page correction. Chromium additionally verifies populated server HTML and independent browser navigation. No coverage exclusions or numerical gates changed.

The subsequent stable-pagination and directional-motion update passed 219 unit/coverage tests in 39 files: statements 63.86% (1836/2875), branches 60.44% (1537/2543), functions 62.1% (413/665), and lines 64.16% (1542/2403). The animation component remains in the production-source denominator; real Web Animations, resize geometry and reduced-motion behavior are exercised in Chromium rather than counted as unit coverage. No measurement exclusions or numerical gates changed.

Reusing the result-motion component on All Posts and Cloud Drive retained 219 passing tests in 39 files on September 13, 2026: statements 63.86% (1836/2875), branches 60.33% (1530/2536), functions 62.1% (413/665), and lines 64.16% (1542/2403). The source scope and exclusions are unchanged; browser tests additionally verify both list routes and file-only advanced search through delayed responses, paging and history.

The Posts-only category control update passed 220 tests in 39 files: statements 63.86% (1838/2878), branches 60.41% (1537/2544), functions 62.1% (413/665), and lines 64.19% (1544/2405). Shared query tests cover category normalization outside Posts scope; browser checks cover the entry animation, reduced motion, hidden controls and history restoration. Measurement scope and exclusions remain unchanged.

The scope-transition update, including Content Editor pagination reuse, passed 223 tests in 40 files: statements 64.27% (1873/2914), branches 60.76% (1561/2569), functions 62.44% (419/671), and lines 64.65% (1575/2436). The scope presentation hook measured 96% branch coverage, including cancelled callbacks, error recovery and unavailable animation support. Real fade timing and scope navigation are additionally exercised by Chromium. No coverage exclusions or numerical gates changed.

The separated exit/entrance and stable editor-page-height refinement retained 223 passing tests in 40 files: statements 64.65% (1913/2959), branches 60.83% (1583/2602), functions 62.7% (422/673), and lines 65.13% (1616/2481). Chromium additionally pauses real exit animations to verify outgoing-tree retention, checks editor height reservations through paging/resizing, and prevents nested page animation during scope changes. Measurement scope and exclusions remain unchanged.

## Mobile and accessibility measurement

The September 13, 2026 responsive-navigation and keyboard-access update passed 227 tests in 41 files: statements 62.67% (1976/3153), branches 59.58% (1632/2739), functions 61.32% (436/711), and lines 63.27% (1661/2625). Unit regressions cover route/skip-link focus without interrupting scroll recording, modal background isolation/restoration, lazy image dimensions and safe Markdown rendering. The mobile drawer and third-party editor DOM adapter remain in the denominator and are exercised in real Chromium, which is not merged into Vitest coverage; their addition lowers aggregate percentages. No measurement exclusion or numerical gate changed. Keyboard, geometry, reduced-motion and axe reports are described in [mobile accessibility verification](accessibility.md).

The category-expansion and search-entry transition refinement passed 228 tests in 41 files: statements 62.56% (1977/3160), branches 59.54% (1634/2744), functions 61.23% (436/712), and lines 63.09% (1660/2631). Search snapshot regressions now cover keyword changes and obsolete exit callbacks; real browser tests verify reversible category height and non-overlapping search/page transitions. Measurement scope and exclusions remain unchanged.

Initial-search feedback refinement passed 230 tests in 42 files: statements 62.69% (1988/3171), branches 59.71% (1647/2758), functions 61.45% (440/716), and lines 63.21% (1669/2640). Tests cover delayed visible feedback, timer cleanup and first-result entry without a placeholder exit; measurement exclusions and gates are unchanged.

## List return and navigation regression measurement

Measured on 2026-09-14 after list-return snapshots, reserved editor height, source-aware sidebar selection, category rename focus restoration, and canonical editor URL assertions. All 240 unit tests in 45 files pass; the original baseline and proposed floors remain unchanged.

| Metric | Covered / total | Result |
| --- | ---: | ---: |
| Vitest statements | 2,065 / 3,252 | 63.49% |
| Vitest branches | 1,728 / 2,848 | 60.67% |
| Vitest functions | 452 / 729 | 62.00% |
| Vitest lines | 1,738 / 2,711 | 64.10% |

The new checks cover snapshot expiry/eviction, cleanup generations, owner isolation, reused pagination content, and sidebar source restoration. No source files were excluded to improve these measurements. Backend code did not change and its coverage was not remeasured.

The subsequent persistent-layout and silent-refresh fixes passed 249 unit tests in 47 files: statements 63.00% (2124/3371), branches 60.31% (1775/2943), functions 62.26% (462/742), and lines 63.66% (1791/2813). The inline bootstrap is tested by evaluating its emitted script and by holding production hydration in Chromium; execution of the emitted string is not attributed back to its function body in this Vitest report. That source remains in the denominator. No coverage exclusions or numerical gates changed.

## Navigation independent of snapshots

The September 14, 2026 measurement passed 262 tests in 48 files with unchanged full-source scope: statements 63.66% (2180/3424), branches 61.36% (1838/2995), functions 62.94% (479/761), and lines 64.25% (1832/2851). Tests cover cold targets and retry, account/session invalidation, preserved history metadata, distinct entries for identical URLs, router commits after DOM replacement, traversal between layout and passive effects, and bounded scroll cancellation. Removed dimension-cache tests were replaced by the deterministic layout contract in Chromium. Browser frame samples and CSS geometry are not merged into Vitest coverage; no exclusions or numerical gates were added. Backend coverage was not remeasured because backend code and setup tools did not change.


## Enforced quality measurement

Measured on September 15, 2026 after targeted decision/lifecycle regressions: 273 frontend tests in 49 files pass. Statements are 64.74% (2217/3424), branches 62.47% (1871/2995), functions 63.99% (487/761), and lines 64.95% (1852/2851). All production-source denominators and exclusions remain unchanged.

Each focused module passes its own 90% branch gate: recovery storage 91.95%, recovery hook 90.41%, departure guard 96.94%, guarded router 100%; search/query/loader and snapshot/return helpers range from 92.11% to 100%. The complete article save/publication function measures 91.89%; the containing editor component remains in global coverage and is not described as 90% covered.

On Go 1.26.8, complete atomic race coverage is 70.75%. Both search query/read functions reach 100%, text extraction 97.1%, versioned mutation 96.1%, and the version migration 100%. Go still reports statements rather than numerical branch coverage. Database/decoding failures, restore, migrations and concurrency remain explicit tests. The enforced global floors are frontend 61/59/60/62% and Go 68%, with 90% focused requirements, as detailed in [quality-gates.md](quality-gates.md).

The six Node gate-helper tests verify failure behavior independently of application coverage. Node 22.23.2 and the local Node 24.9.0 both pass those helpers and all 273 coverage tests with identical global and focused measurements. The standalone frontend production build also passes on Node 22.23.2. Reports are retained on failure; no threshold auto-update is enabled. These are local Windows measurements, and remote Linux CI/container results remain separate evidence.

## Resource transitions and first-save continuity

The subsequent frontend update passes 275 tests in 49 files: statements 64.92% (2232/3438), branches 62.77% (1887/3006), functions 63.92% (489/765), and lines 65.22% (1866/2861). All existing global and focused gates pass without changing their thresholds or exclusions. New units verify that displayed rows retain their response criteria during a pending search, and that an inactive resource uses its own criteria for both server and cache snapshots. Browser transition frames, empty-result exits/entrances and first-save form geometry remain separate Playwright evidence.

The follow-up editor document and save-handoff correction passes 278 tests in 49 files: statements 64.88% (2240/3452), branches 62.96% (1909/3032), functions 63.76% (491/770), and lines 65.22% (1872/2870). New cases cover delayed router parameters after native history updates, matching server details, and rejection of details from a different target or authenticated owner. All existing global and focused thresholds remain unchanged and pass; the complete save/publication function remains at 91.89% branch coverage. SSR/hydration opacity and geometry, empty-result Loading flashes, and development-mode first saves are verified separately in the browser.

After the toolbar locale hydration correction, the same 278 unit tests pass with statements 64.75% (2240/3459), branches 62.96% (1909/3032), functions 63.43% (491/774), and lines 65.11% (1872/2875). All thresholds and exclusions remain unchanged. Locale initialization and the mounted toolbar refresh are exercised by English/Chinese browser regressions, including development-mode console checks, rather than counted as unit coverage.
