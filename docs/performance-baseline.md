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
