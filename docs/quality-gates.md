# Quality gates

Coverage gates prevent regression within a fixed measurement scope. They supplement API, database, browser and deployment checks; they do not establish complete correctness. Changes to floors or scope require a documented reason and review. Neither the checks nor CI update their own thresholds.

## Enforced floors

| Measurement | Minimum | Scope |
| --- | ---: | --- |
| Frontend statements / branches / functions / lines | 61% / 59% / 60% / 62% | All production `src` TS/TSX, including untested components |
| Focused frontend branches | 90% for each module | Resource/search queries and loaders, post snapshots, editor return targets, recovery store/hook, departure guard and guarded router |
| Article save/publication branches | 90% | Entire `handleSave` function, including its nested callbacks, in `EditorPageClient.tsx` |
| Go statements | 68% | Atomic `-coverpkg=./...` profile across the complete module |
| Focused Go statements | 90% for each function | Search `Query`/`Read`, text `Extract`, `mutatePost`, and `addPostVersions` |

The floors use the pre-gate measurement of frontend 63.66/61.36/62.94/64.25% and Go 70.68%, leaving approximately two percentage points of margin. These measurements were taken on Windows; investigate platform differences rather than automatically lowering a floor.

Vitest enforces the global floors. `tools/quality/coverage.mjs` requires every named focused source/function to exist in the full report and checks each separately. A renamed or missing source fails. Function coverage includes every reported decision inside its source range; it does not imply that the entire editor page has 90% branch coverage. The editor page and all other production code remain in the global denominator.

Frontend reports include text, HTML, LCOV, JSON summary and full Istanbul JSON. The latter supports the function-level check; browser execution is not merged into it. Go duplicate profile blocks from different package test binaries are merged before computing the global statement ratio. Function floors use `go tool cover`'s reported statement percentages. Empty/malformed reports, missing functions, mismatched duplicate blocks and insufficient coverage fail the command.

## Go decision acceptance

Go provides statement coverage, not a numeric branch percentage. Decision outcomes are verified explicitly by the following tests alongside the numerical statement floors:

| Contract | Decision outcomes | Regression tests |
| --- | --- | --- |
| Search | public/admin scopes; category present/absent; exact totals; ties; combined limits; invalid/deep pages; database failure | `TestSearchPaginationAndVisibility`, `TestSearchMaximumPageAndDatabaseFailure` |
| Consistency | visibility changes cannot split totals from the returned page | `TestSearchCountsAndPageShareAConcurrentWriteSnapshot` |
| Read decoding | query failure, malformed post/file data, valid empty response | `TestReadRejectsInvalidDatabaseResults` |
| Publication | matching/stale versions, competing writers, validation and rollback | `TestArticleUpdateValidationAndRollbackPreserveVersions`, `TestArticleVersionsProtectConcurrentWritesAndPublication` |
| Category changes | deletion invalidates the version and competes atomically with save | `TestCategoryDeletionInvalidatesArticleVersionsWithoutEditingTimeline`, `TestCategoryDeletionCompetesWithVersionedArticleSave` |
| Upgrade | backfill and unchanged timestamps; absent extension/permissions; failed migration rollback; version trigger | Search and article-version migration integration suites |

The decoder test supplies invalid driver results without adding a mocking dependency. Actual SQL, totals, ordering, permissions and transactions are still verified against PostgreSQL; a synthetic row does not substitute for those integration tests.

## Run and retain evidence

From the repository root:

```text
node --test tools/quality/*.test.mjs
npm run test:coverage --prefix frontend
```

From `backend`, after configuring the guarded disposable test database:

```text
go test -race -p 1 -count=1 -covermode=atomic -coverpkg=./... -coverprofile=coverage.out -json ./...
go tool cover -func=coverage.out
```

Save JSON test events to `test-results.json` and the function report to `coverage-summary.txt`, generate `coverage.html`, then run `node ../tools/quality/coverage.mjs backend .`. Stop if any command fails; shell pipelines must preserve the original test exit status. See [testing.md](testing.md) for PowerShell commands and database prerequisites.

CI retains coverage/test reports even on failure and retains available query plans and benchmark reports when their steps fail. Gate helper tests prove negative paths, including duplicate Go blocks and npm's distinct outdated-versus-error exit behavior. Workflow syntax and semantics are checked with pinned actionlint. No timing-based performance floor is inferred from local benchmarks.

Coverage output remains excluded from Git and Docker contexts. Gate scripts live outside the application build contexts; they are not required by production runtime images. Container topology is validated in GitHub Actions; see [testing](testing.md#continuous-integration).
