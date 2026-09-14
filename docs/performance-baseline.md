# Anonymous Public Read Baseline

This record provides a repeatable starting point for the single-instance, anonymous-read-heavy deployment profile. It is intended to reveal regressions between revisions; it is not a production load test, concurrency limit, or hosting guarantee.

## Workload

`BenchmarkAnonymousPublicReads` seeds an isolated PostgreSQL test database with:

- 200 published posts across 10 categories;
- 100 public file metadata records;
- representative public profile settings.

Each operation sends a Cookie-free request through the real Gin router, request logging/metrics middleware, handlers, GORM, and PostgreSQL. It covers a 10-item post page, one post detail, category counts, a 10-item file page, public settings, and a search term that matches all seeded posts. Network transport, TLS, Caddy, Next.js rendering, browser work, file bytes, and concurrent clients are outside this benchmark.

## Initial reference

Recorded on 2026-08-26 with three 500 ms samples per operation:

- Windows 10 Enterprise 64-bit;
- AMD Ryzen 7 7700, 8 cores / 16 logical processors;
- Go 1.26.2, `windows/amd64`;
- local PostgreSQL 18.3;
- no local Docker Compose services.

| Operation | Median | Observed range | Heap / operation | Allocations / operation |
| --- | ---: | ---: | ---: | ---: |
| Post list | 0.323 ms | 0.320–0.328 ms | 62.2 KiB | 748 |
| Post detail | 0.166 ms | 0.165–0.167 ms | 25.9 KiB | 272 |
| Categories | 0.185 ms | 0.185–0.187 ms | 22.4 KiB | 250 |
| File list | 0.204 ms | 0.203–0.204 ms | 28.0 KiB | 406 |
| Settings | 0.086 ms | 0.086–0.086 ms | 14.2 KiB | 127 |
| Search matching 200 posts | 1.403 ms | 1.396–1.409 ms | 825.9 KiB | 7,612 |

The search case is intentionally the heaviest because it loads and filters every matching article and serializes a roughly 125 KiB response in this fixture. It is the first operation to re-check if the public corpus or real search traffic grows materially. The initial result does not justify adding Redis, multiple API replicas, or a separate search engine.

## Comparison policy

GitHub Actions runs a short version of the same benchmark and uploads its raw output for 30 days. The job has no timing threshold because hosted-runner and database noise can produce false failures. When reviewing a suspected regression:

1. compare the same operation, dataset, command, and platform;
2. use at least three samples and compare medians;
3. investigate a repeatable increase of roughly 20% or a substantial allocation increase;
4. confirm with a network load test on the actual VPS before making capacity or scaling decisions.

Run the longer local reference command documented in [`testing.md`](testing.md). Never point it at development or production data; the test helper requires a database name ending in `_test` and resets its contents.

## Long-body and response-size reference

Recorded on 2026-09-06 on the same Windows/Ryzen 7 7700/Go 1.26.2/PostgreSQL 18.3 platform, with three 500 ms samples and no concurrent benchmark/database workload. The application read behavior is unchanged. The new metric is the uncompressed recorded HTTP response body, not network traffic or a cache measurement.

| Original workload | Median | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list | 0.361 ms | 6,304 | 61.0 KiB | 748 |
| Post detail | 0.180 ms | 623 | 25.9 KiB | 272 |
| Categories | 0.205 ms | 1,212 | 22.5 KiB | 250 |
| File list | 0.223 ms | 2,013 | 28.0 KiB | 406 |
| Settings | 0.093 ms | 81 | 14.2 KiB | 127 |
| Search matching 200 posts | 1.370 ms | 125,156 | 820.7 KiB | 7,612 |

The original six cases remain comparable to the earlier reference: timings range from about -2% to +12% and allocations remain essentially stable. This is a reporting change and a fresh baseline, not an application optimization result.

`BenchmarkAnonymousLongBodyReads` adds the [isolated long-body fixture](query-analysis.md): 2,400 posts (1,920 published), 1,200 file records (1,080 public), 40 categories and approximately 132 MiB of total Markdown. The detail case uses a published 128 KiB article. The rare search term is `needlequartz`; the common term `article` matches all published titles.

| Long-body workload | Median (observed range) | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list, limit 10 | 2.397 ms (2.342–2.626) | 485,635 | 2.80 MiB | 751 |
| Post detail | 0.615 ms (0.598–0.650) | 132,745 | 683.2 KiB | 299 |
| Categories | 0.632 ms (0.627–0.653) | 4,363 | 40.9 KiB | 588 |
| File list, limit 10 | 0.444 ms (0.437–0.458) | 2,123 | 29.5 KiB | 456 |
| Settings | 0.090 ms (0.089–0.090) | 39 | 14.0 KiB | 117 |
| Rare search, 17 posts | 792.906 ms (787.936–797.602) | 1,019,408 | 14.40 MiB | 1,457 |
| Common search, 1,920 posts | 274.773 ms (272.817–396.421) | 112,237,553 | 504.95 MiB | 73,509 |

The common search allocates 504.95–673.71 MiB/op across these samples; this is cumulative allocation, not peak resident memory. Rare search executes one request per sample because it exceeds the target duration, and common search executes two. Treat these as a starting reference and increase the sample duration/count for close performance decisions.

The different corpora are not before/after optimization pairs. Preserve both fixtures and compare each with itself after summary projection and pagination are implemented. SQL-only EXPLAIN does not include body transfer, visible-text filtering or JSON serialization; use both measurement types.

GitHub Actions uploads both raw benchmark reports and query plans for 30 days without timing gates. Synthetic metadata contains no real file bytes or private user content. The new long-body fixture rolls back its schema, while the original small benchmark retains its existing dedicated-test-database reset behavior.

## Article summary comparison

Measured on 2026-09-06 after replacing ordinary list projections and list/search JSON with article summaries. This run uses the same machine, toolchain, fixtures and three 500 ms samples as the response-size reference above. Backend integration tests and browser servers finished before benchmarking; the query experiment ran afterward. No migration, new index or search query rewrite is included.

| Original workload after change | Median (observed range) | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list | 0.379 ms (0.377–0.393) | 5,084 | 60.6 KiB | 731 |
| Post detail | 0.193 ms (0.191–0.201) | 621 | 25.9 KiB | 272 |
| Categories | 0.214 ms (0.211–0.218) | 1,212 | 22.6 KiB | 250 |
| File list | 0.232 ms (0.230–0.238) | 2,013 | 28.0 KiB | 406 |
| Settings | 0.098 ms (0.096–0.099) | 81 | 14.2 KiB | 127 |
| Search matching 200 posts | 1.495 ms (1.482–1.500) | 100,756 | 801.4 KiB | 7,612 |

The short-body fixture reduces list/search payloads by about 19%; these timings are roughly 4–9% slower than the immediately preceding reference, with no repeatable timing improvement established. Small detail-byte variations can reflect the fixture's generated timestamp precision; the fixed long-body detail remains exactly the same size. Ordinary categories, files and settings retain their payloads and allocation counts.

| Long-body workload after change | Median (observed range) | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list, limit 10 | 0.559 ms (0.550–0.565) | 4,452 | 56.3 KiB | 671 |
| Post detail | 0.647 ms (0.627–0.657) | 132,745 | 685.2 KiB | 300 |
| Categories | 0.655 ms (0.653–0.681) | 4,363 | 41.1 KiB | 588 |
| File list, limit 10 | 0.466 ms (0.463–0.471) | 2,123 | 29.6 KiB | 456 |
| Settings | 0.093 ms (0.093–0.095) | 39 | 14.0 KiB | 117 |
| Rare search, 17 posts | 686.254 ms (674.419–688.965) | 7,398 | 8.93 MiB | 1,422 |
| Common search, 1,920 posts | 168.730 ms (168.500–170.071) | 830,465 | 125.00 MiB | 73,511 |

The long-body list shrinks from 485,635 to 4,452 bytes (99.08%), with median time falling from 2.397 to 0.559 ms and heap allocation from 2.80 MiB to 56.3 KiB. Rare/common search responses shrink by 99.27%/99.26%; common-search cumulative allocation falls from 504.95 to 125.00 MiB and median time from 274.773 to 168.730 ms. Public detail retains the full article and similar allocation behavior.

At that summary-only measurement, search remained unpaginated and transferred candidate bodies from PostgreSQL for the Go visible-text filter. Its rare-query latency and common-query 125 MiB allocation remain substantial. These results demonstrate SQL projection and response serialization savings; they do not establish bounded search memory, database-query optimization, production throughput or a capacity guarantee. Rare search still has one request per sample and common search now has three; use longer samples for close timing decisions. The subsequent normalized-text query, exact totals and combined pagination are measured below.

## Normalized search and pagination comparison

Measured on 2026-09-07 against the same corpora, native PostgreSQL 18.3 and Windows/Go/Ryzen platform. Each case has three 500 ms samples. Database suites, browser servers and heavy workloads finished before benchmarking. The detail rows were remeasured after removing an unnecessary derived-text projection; the other rows retain their full-suite samples. Generated category timestamps can vary slightly in fractional precision, accounting for a few bytes of unrelated list/category variation.

### Original short-body fixture

| Operation | Median (observed range) | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list, limit 10 | 0.339 ms (0.331–0.346) | 5,104 | 61.2 KiB | 731 |
| Post detail | 0.170 ms (0.167–0.171) | 623 | 28.4 KiB | 289 |
| Categories | 0.195 ms (0.195–0.200) | 1,212 | 22.3 KiB | 250 |
| File list, limit 10 | 0.181 ms (0.181–0.184) | 2,013 | 28.0 KiB | 406 |
| Settings | 0.091 ms (0.088–0.092) | 81 | 14.2 KiB | 127 |
| Search, first 10 matches | 0.645 ms (0.635–0.747) | 5,150 | 87.9 KiB | 310 |

### Long-body fixture

| Operation | Median (observed range) | Response bytes | Median heap / operation | Median allocations |
| --- | ---: | ---: | ---: | ---: |
| Post list, limit 10 | 0.517 ms (0.511–0.527) | 4,443 | 57.0 KiB | 670 |
| Post detail | 0.692 ms (0.625–0.755) | 132,745 | 667.4 KiB | 315 |
| Categories | 0.615 ms (0.600–0.624) | 4,323 | 40.5 KiB | 587 |
| File list, limit 10 | 0.282 ms (0.277–0.283) | 2,123 | 29.4 KiB | 456 |
| Settings | 0.084 ms (0.084–0.085) | 39 | 13.9 KiB | 117 |
| Search, first 10 matches | 9.238 ms (8.968–9.267) | 4,448 | 87.2 KiB | 321 |
| Common search, first 10 matches | 2.514 ms (2.449–2.535) | 4,490 | 84.6 KiB | 325 |

The previous search returned all matches: 200 on the short fixture, 17 for the rare long-body term and 1,920 for the common long-body title. The new default returns at most ten and includes exact totals for all matches. The reduced payload and serialization allocation therefore partly reflect the new pagination contract; they must not all be attributed to a faster SQL predicate.

Against the immediately preceding summary-only implementation, rare long-body search changes from 686.254 to 9.238 ms, 7,398 to 4,448 response bytes and approximately 8.93 MiB to 87.2 KiB of cumulative heap allocation. Common-title search changes from 168.730 to 2.514 ms, 830,465 to 4,490 bytes and 125.00 MiB to 84.6 KiB. The actual query plan separately verifies indexed selective matching and a skipped body branch for common-title matches; see [query-analysis.md](query-analysis.md).

The initial detail rerun exposed an avoidable read of `search_text` alongside Markdown. Public/admin detail and update readback queries now omit the derived field, with a projection regression assertion. Final long-body detail remains a complete 132,745-byte response, at 0.692 ms and 667.4 KiB median allocation, close to the earlier 0.647 ms / 685.2 KiB behavior. The explicit projection adds some small query-building allocation; no detail speedup is claimed.

These are in-process warm-database regression measurements. Short/common body terms can still scan the derived corpus for exact totals, GIN increases write cost, and offset pages remain mutable between separate requests. No production capacity or timing gate is inferred from this synthetic corpus.

## Dependency update regression comparison

Measured on September 15, 2026 against the preceding committed implementation on the same Windows/Ryzen 7 7700/PostgreSQL 18.3 environment. Both revisions use Go 1.26.8, identical benchmark source and three 500 ms samples per operation, with no concurrent benchmark or database test. This isolates the module updates from the toolchain difference in older historical measurements. The application query and response contracts did not change.

| Operation | Before median ms | After median ms (range) | Time change | Response bytes before / after | Heap KiB before / after | Allocations before / after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Short post list | 0.328 | 0.323 (0.322–0.331) | -1.5% | 5,094 / 5,094 | 61.2 / 61.2 | 730 / 730 |
| Short post detail | 0.177 | 0.173 (0.173–0.173) | -2.1% | 634 / 634 | 28.7 / 28.7 | 293 / 293 |
| Short categories | 0.258 | 0.255 (0.254–0.260) | -1.2% | 1,202 / 1,202 | 22.1 / 22.2 | 250 / 250 |
| Short file list | 0.180 | 0.178 (0.177–0.178) | -1.0% | 1,993 / 2,013 | 28.0 / 28.0 | 406 / 406 |
| Short settings | 0.088 | 0.087 (0.087–0.088) | -1.3% | 81 / 81 | 14.2 / 14.2 | 127 / 127 |
| Short search | 0.627 | 0.619 (0.599–0.671) | -1.2% | 5,140 / 5,140 | 87.6 / 87.3 | 310 / 310 |
| Long post list | 0.524 | 0.511 (0.506–0.516) | -2.5% | 4,443 / 4,452 | 56.9 / 56.9 | 670 / 670 |
| Long post detail | 0.532 | 0.554 (0.543–0.590) | +4.2% | 132,756 / 132,757 | 658.2 / 661.7 | 319 / 319 |
| Long categories | 0.626 | 0.633 (0.629–0.640) | +1.1% | 4,323 / 4,363 | 40.4 / 40.4 | 587 / 587 |
| Long file list | 0.286 | 0.284 (0.278–0.285) | -0.8% | 2,123 / 2,123 | 29.4 / 29.4 | 456 / 456 |
| Long settings | 0.083 | 0.083 (0.083–0.084) | +0.2% | 39 / 39 | 13.9 / 13.9 | 117 / 117 |
| Long rare search | 9.213 | 9.393 (9.042–9.426) | +1.9% | 4,448 / 4,457 | 85.1 / 85.6 | 319 / 319 |
| Long common search | 2.545 | 2.524 (2.474–2.658) | -0.8% | 4,490 / 4,499 | 83.6 / 84.4 | 324 / 325 |

Medians vary from -2.5% to +4.2%, with no material allocation regression in this sample. Small byte differences are consistent with the fixture's automatically generated category/file timestamps and JSON fractional-second precision, including embedded categories in article summaries; the full Markdown detail remains present. These warm, in-process samples establish neither a speedup nor production capacity. Retain the existing investigation policy and review actual query plans alongside these measurements. CI continues to retain raw benchmark reports, including available output after failures, without a timing gate.
