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
