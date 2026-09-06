# Query Analysis

The query-analysis harness measures candidate SQL in a disposable schema. It does not add application fields, indexes, migrations or API behavior. Implemented summary/detail reads and proposed search changes are distinguished in [search-contract.md](search-contract.md).

## Reproducible fixture and isolation

`TestQueryAnalysis` requires `TEST_DB_DSN` with a database name ending in `_test` and an explicit `QUERY_ANALYSIS_OUTPUT` destination. It opens a dedicated connection and outer transaction, creates a cryptographically random schema, applies existing migrations with that schema as the sole search path, then exposes `public` for extension lookup. All fixture rows, experimental columns, indexes and any newly installed extension roll back on exit. A separate integration test verifies that the schema disappears. It never resets the ordinary test schema.

The deterministic `long-body-v1` fixture contains 2,400 articles, 1,200 file records and 40 categories. Article bodies alternate between approximately 8, 32 and 128 KiB; total Markdown is 138,112,234 bytes. Text varies by fixed random seed over a limited dictionary, with Chinese prose, hidden link/image metadata and a rare marker. This avoids one repeated, trivially compressed body but remains a synthetic corpus, not a production-size/compressibility guarantee.

Twenty percent of articles are drafts; ten percent of file records are system files. Categories are deliberately skewed, include uncategorized articles, and timestamps tie. Search terms exercise common/rare/no matches, one-character Chinese and longer Chinese text, hidden metadata, and administrator-only file descriptions. Original HTTP benchmarks and their smaller fixture remain intact.

Run from `backend` after configuring the disposable test connection through the environment, with no credentials written to reports:

~~~powershell
$env:QUERY_ANALYSIS_OUTPUT = Join-Path (Get-Location) 'query-analysis.json'
go test -run '^TestQueryAnalysis$' -count=1 -v ./internal/routes
Remove-Item Env:QUERY_ANALYSIS_OUTPUT
go test -run '^$' -bench '^BenchmarkAnonymousPublicReads$' -benchmem -benchtime=500ms -count=3 ./internal/routes
go test -run '^$' -bench '^BenchmarkAnonymousLongBodyReads$' -benchmem -benchtime=500ms -count=3 ./internal/routes
~~~

The analysis normally takes several minutes. Run it sequentially with integration tests, backup drills, benchmarks and E2E: the outer migration transaction holds the existing advisory lock until rollback. Do not benchmark while another heavy workload is active. Each statement has a 120-second timeout and lock acquisition has a 10-second timeout.

## Measurement method

Each SELECT runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` three times. Reports retain SQL, synthetic parameters, every full plan (including actual rows, loops and buffers), and the median PostgreSQL execution time. Baseline cases include list/count/category queries, first/deep pages, a 100-row page, and current public/administrator search candidates. Candidate experiments additionally measure the final summary projection, normalized search page/count, mixed pages and empty far-out pages.

The retained full-body list SQL is the historical comparison baseline. The application now uses the measured summary column projection for ordinary lists; integration tests capture its actual SQL and reject selection of `content`. Search still reads complete candidates before backend filtering, while its JSON now uses summaries. No experimental index or normalized search field has been installed by the read split. Before/after router measurements are recorded in [performance-baseline.md](performance-baseline.md).

The current search SQL fetches candidate bodies without a limit and then performs visible-text filtering in Go. Its SQL candidate count is explicitly labelled as such: it is not a trustworthy public result total. GORM category preload, result transfer, JSON serialization and Go filtering are measured by the real-router HTTP benchmark rather than this SQL-only plan.

The normalized prototype uses fixture-supplied visible body text and tests query mechanics; it is not a second Markdown parser. Materialize matching title/summary IDs and the remaining authorized IDs, then UNION body matches with metadata and live category matches. An explicit EXISTS guard skips the body branch when no IDs remain. This preserves field boundaries and permits a body-only trigram condition without forcing a scan after every authorized article already matched metadata. For partial metadata matches, inspect the actual plan rather than assuming the planner evaluates a written WHERE order. Mixed resource IDs use one materialized candidate set and one SQL statement for totals and page, with deterministic timestamp/kind/ID ordering.

Executable assertions independently count the rare matches, recover them across pages without duplicates, verify tied-order repeatability and the combined ten-result cap, preserve totals on an empty far-out page, and exclude drafts, system files and hidden metadata. The prototype returns IDs; summary hydration and concurrency coverage belong to the API implementation.

Candidate indexes are created and removed with savepoints. The report records build wall time, index bytes and three rollback-only update probes, with a matching no-candidate write baseline. Writes target 100 IDs (80 published rows for the partial category index). These timings include client/driver cost and are not production write-latency predictions. Warm buffers, aborted tuple versions within a transaction and planner estimates can affect the samples; no sequential-scan or planner setting is disabled to force an index.

`EXPLAIN` ordinarily omits client output serialization, so a small execution time for a full-body SELECT does not prove a small transfer/allocation cost. See [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html) and the [HTTP measurements](performance-baseline.md).

## Measured decisions

The 2026-09-06 run recorded 45 baseline/projection measurements and six experiments: 131 SELECT measurements, each retaining three actual plans. The following timings are SQL execution medians in milliseconds, not end-to-end API timings.

| Candidate / operation | Without candidate | With candidate | Decision |
| --- | ---: | ---: | --- |
| Category timeline, dense summary page | 0.022 | 0.023 | Do not add; existing indexes already handle the page cheaply |
| Category timeline, sparse summary page | 0.045 | 0.017 | Do not add; absolute improvement is too small for another index |
| Administrator ordering, first summary page | 1.328 | 0.016 | Retain for the next migration |
| Administrator ordering, deep summary page | 3.131 | 2.565 | Small/variable benefit; no deep-page guarantee |
| Public file ordering, first page | 0.181 | 0.012 | Retain for the next migration |
| Public file ordering, deep page | 0.335 | 0.342 | No deep-page improvement |
| Derived body GIN, rare public page | 887.868 | 10.169 | Retain with the measured query shape and extension prerequisite |
| Derived body GIN, rare public total | 849.028 | 9.097 | Accurate total is accelerated as well |
| Derived body GIN, rare administrator page | 867.448 | 10.419 | Supports administrator search too |
| Derived body GIN, mixed rare page plus totals | 840.032 | 10.866 | Supports one combined limited page |
| Derived body GIN, no-match public total | 853.877 | 2.357 | Avoids reading every body for a selective miss |
| Derived body GIN, common-title public page | 3.354 | 3.430 | Body branch actually executes zero times |
| Derived body GIN, one-character Chinese total | 754.864 | 774.966 | No useful acceleration; keep semantics and existing rate boundary |
| Derived body GIN, common Chinese phrase total | 790.123 | 745.196 | Still a scan-heavy common match |
| Effective file-name GIN, rare search | 0.450 | 0.044 | Defer; small absolute gain at this file count |
| Effective file-name GIN, common search | 0.662 | 0.865 | Defer; common query did not benefit |

Rounded values should be checked against the raw artifact for detailed comparisons. The chosen new index set is an administrator draft-priority/updated-time/ID B-tree, a public-file created-time/ID partial B-tree, and one GIN on derived visible body text. Keep existing indexes. No new category, title, summary or file-name trigram index is justified by this run.

| Candidate | Index size | Build time | Update probe before / after |
| --- | ---: | ---: | ---: |
| Category timeline (rejected) | 96 KiB | 3.01 ms | 26.59 / 26.59 ms |
| Administrator order | 112 KiB | 4.01 ms | 31.11 / 30.10 ms |
| Public file order | 56 KiB | 3.01 ms | 1.00 / 1.00 ms |
| Derived body GIN | 888 KiB | 11.84 s | 117.90 / 624.14 ms |
| Effective file-name GIN (deferred) | 112 KiB | 8.03 ms | 1.00 / 3.01 ms |

GIN makes this 100-row body update about 5.3 times more expensive. That tradeoff is acceptable as a proposal for the existing read-heavy, single-administrator workload, but index build/backfill maintenance time and real write performance must be rechecked with the actual extractor and final migration. A large common corpus can still make exact counts expensive; pagination bounds transfer, not all database work.

Two rejected query shapes explain the explicit remaining-ID guard. Unconditionally UNIONing body matches forced common-title searches to scan bodies. A same-table OR with title/summary/body GIN indexes still selected a sequential scan for rare terms on this fixture. The selected query uses a body-only indexed predicate, and its common-title plan shows zero executions of the body index branch; its rare plan uses that index. Do not remove this guard, concatenate distinct fields, disable sequential scans, or add unused indexes to improve a single headline number.

These are recommendations for a future migration, not installed application indexes. Recheck them against the final DTO/search SQL and CI's collation. The raw plan includes actual row and buffer evidence; the common-title query's modest SQL overhead compared with the existing 1.67 ms candidate SELECT also buys exact totals and a bounded page, whose HTTP impact must be assessed with the retained benchmark.

## Extension and upgrade requirements

The measured local server is PostgreSQL 18.3, with `Chinese (Simplified)_China.936` collation/ctype. The configured **test** role has database CREATE and superuser privileges. `pg_trgm` is available and was not preinstalled; installation succeeded inside the rollback-only transaction. This verifies the test role, not the privileges of an unknown deployment or restore role. CI records its own Linux collation and permissions in the artifact.

PostgreSQL documents `pg_trgm` as a trusted extension installable by a non-superuser with database CREATE; its indexes support ILIKE, while patterns without usable trigrams may require full scanning. See [pg_trgm](https://www.postgresql.org/docs/18/pgtrgm.html) and [CREATE EXTENSION](https://www.postgresql.org/docs/18/sql-createextension.html). Keep short and Chinese queries valid.

For the future indexed-search release, make the PostgreSQL extension package and an operator-preinstalled `pg_trgm` in the agreed schema explicit prerequisites. Do not grant the application runtime role broader privileges or silently omit required indexes. The migration must check availability and operator-class/schema access, fail with an actionable sanitized error if missing, and leave history/data unchanged on failure. The native experiment records permission failure and still measures a no-extension reference; that experiment fallback is not an application deployment policy.

A new derived-text migration will need bounded backfill, index build time/space planning, historical fixture tests and repeat/failure/concurrency tests. Use a maintenance window for the existing transactional migrator; `CREATE INDEX CONCURRENTLY` cannot simply be inserted into that transaction. On failed migration, retain the old schema and matched release. Once an upgrade has committed, do not start an older binary against newer history.

Backups require the matching PostgreSQL client major version and application restore release. Restore an old bundle first with tooling matching its recorded migration version into an isolated empty target, then migrate with the newer release. Verify extension availability/permissions on that target before the new indexed-search migration or restoring an extension-bearing dump. Do not weaken the existing migration-version checks. Current backup bundles and application migration history are unchanged.
