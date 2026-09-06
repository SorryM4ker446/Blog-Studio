# Search and Article Read Contract

Article summaries and protected administrator detail reads are implemented. Ordinary article lists select summary columns, and both public and administrator search responses omit `content`. Search still reads full matching bodies for the existing backend visible-text filter and remains unpaginated. The pagination, normalized-text migration and expanded URL rules below are proposed contracts, not current API behavior. Query prototypes and their evidence are in [query-analysis.md](query-analysis.md).

## Resource representations and access

| Representation | Fields and responsibility |
| --- | --- |
| `PostSummary` | `id, title, slug, summary, category_id, category, status, published_at, last_edited_at, created_at, updated_at`; never `content` or derived search text |
| `PostDetail` | Summary fields plus `content`; the later optimistic-concurrency implementation adds the administrator version token |
| Article write input | Explicit editable fields, separate from read types; version and publication actions follow the editor contract when implemented |
| File result | Existing public file metadata; no storage paths, bytes or credentials |

Ordinary lists use explicit SQL projection without `content`. Search currently converts the full records required by its backend filter to summary DTOs before serialization; the proposed normalized-text query will also eliminate full-body search reads. Public post detail stays `GET /api/posts/:id` and cannot reveal drafts, including when an administrator Cookie is supplied. `GET /api/admin/posts/:id` uses the existing authentication and administrator middleware and returns `Cache-Control: no-store`. Missing articles return `404 post_not_found`; unauthorized requests follow existing 401/403 behavior.

Editor now obtains the full article after clicking an edit action or a draft card. The form uses the fresh detail response for every editable field. Loading and failure states provide a way back to the list; failures can be retried, and no saveable form appears until a complete matching detail response arrives. Returning to the list or unmounting aborts the request and ignores late success/error responses. Creating a new draft does not request an existing article. List HTML and server-component props contain summaries only. Direct editor URLs remain proposed below.

Visible-text post-filtering has one owner, the backend. Clients retain body-only search matches returned as summaries without trying to filter them again. The backend's existing regular-expression extraction is unchanged; the parser/backfill rules below are still pending. Saving, publication status selection and the existing return-to-list behavior are unchanged by the read split.

Removing `content` is a breaking response change for consumers that edit from list results. Deploy frontend and backend together, and reload already-open clients after upgrade. Roll back the pair together if needed. This read split adds no migration, index, extension, configuration variable or deployment service. Public detail and successful article write responses retain complete bodies; file endpoints keep their existing behavior.

## Proposed paginated search request and response

Both `GET /api/search` and `GET /api/admin/search` accept:

| Parameter | Contract |
| --- | --- |
| `q` | Required, trimmed, nonempty, at most 200 Unicode characters; literal case-insensitive substring matching |
| `scope` | `all` (default), `posts` or `files` |
| `category_id` | Existing nonnegative integer filter; `0` means uncategorized; only restricts posts |
| `page` | Decimal integer, 1–1,000,000; default 1 |
| `limit` | Decimal integer, 1–100; default 10 |
| `include_system` | Administrator endpoint only; existing Boolean/default behavior stays intact |

Reuse stable API validation errors. Invalid values such as `2x` must not become page 2. Escape `%`, `_` and backslash before binding the literal LIKE pattern. Public requests cannot widen access by passing administrator parameters.

The response retains `posts` and `files` arrays and adds `posts_total, files_total, total, page, limit`. Empty arrays are `[]`. Totals count all matching authorized resources after scope and category filtering, before pagination. The excluded resource kind has total zero. A valid page beyond the end returns empty arrays and the real totals.

For `scope=all`, `posts.length + files.length <= limit`. There is one combined page, never a separate limit for each kind. A category filter may leave file matches even when there are no matching posts.

| Query | Stable ordering |
| --- | --- |
| Public posts | `COALESCE(last_edited_at,published_at) DESC, id DESC` |
| Administrator post search | `updated_at DESC, id DESC` |
| Administrator ordinary post list | Existing draft priority, then `updated_at DESC, id DESC` |
| Files | `created_at DESC, id DESC` |
| Combined search | Corresponding resource timestamp DESC, `kind ASC` (`file` before `post`), `id DESC` |

Build candidate IDs with `UNION` to deduplicate article fields/category matches, then `UNION ALL` across resource kinds. A single SQL statement derives totals and the ordered page from one materialized candidate set. Hydrate only those page IDs with summary columns in that same statement; alternatively, if ORM hydration requires another statement, wrap both in a read-only REPEATABLE READ transaction. Ordinary READ COMMITTED statements alone do not supply the required shared snapshot.

The response arrays are grouped by kind, preserving each kind's relative order within the combined page. They do not encode cross-kind interleaving; the UI retains separate article/file sections and uses the shared page control. Writes between separate page requests can change results; offset pagination does not promise a historical snapshot across requests.

## Proposed visible text and database consistency

Use one backend Markdown parser/AST traversal shared by migration backfill and every create/update path. Store derived **body-only** text, keeping title, summary and category matching separate so a query cannot span artificial field boundaries. Resolve category names live; category renames must immediately affect searches.

Extraction rules:

- Keep rendered prose, headings, list/quote text, code span/block text and visible link labels, including reference links and nested formatting.
- Remove complete images, including alt/title/source; remove link destinations, reference definitions, and bare/autolink HTTP(S) URLs, preserving the established search boundary.
- Decode text entities as rendered. Insert line boundaries between blocks; normalize CRLF to LF without stripping Chinese characters, punctuation or combining sequences.
- Match the current renderer's `html: false` behavior: raw HTML stays escaped literal text, with the same bare-URL exclusion; never execute or interpret it as active HTML. Retain visible text according to the supported Markdown syntax.
- Keep case-insensitive substring semantics; do not introduce stemming, fuzzy matching, ranking, accent folding or a minimum three-character query length.

Use parameterized PostgreSQL `ILIKE` consistently for candidate fields. Record database collation/ctype and test non-ASCII case behavior against the previous Go filtering before enabling the new query. Chinese one-character and two-character queries remain valid even when a trigram index cannot accelerate them. Unicode and Markdown fixtures must cover hidden URLs, reference images, entities, nested links, fenced code, empty output, category renames and literal wildcard characters.

The experiment supplies known visible text directly: it proves query mechanics, **not** that a production Markdown extractor has been implemented or validated. The implementation must establish golden extraction fixtures first, then use the identical extractor for historical rows and new writes. No frontend post-filtering may alter totals after database pagination.

Add a new versioned migration; never edit the meaning of an applied migration or derive a legacy fixture from the evolving current model. Backfill in bounded batches without changing original Markdown, publication dates or edit timestamps. Add only indexes supported by the measured final query. Extension preconditions, rollback and matched backup tooling are specified in [query-analysis.md](query-analysis.md).

## Proposed URL and navigation state

| Page | Parameters | Transition |
| --- | --- | --- |
| All Posts | `q, category, page` | Search/clear/category changes reset page; paging preserves filters |
| Drive | `q, page` | Search/clear resets page; paging preserves query |
| Advanced search | `q, scope, category, page` | Default scope all; condition changes reset the shared page |
| Editor list | `tab, q, category, post_page, file_page` | Search/category changes reset active resource page; tab changes clear q/category and reset the destination page |
| Editor form | List parameters plus `edit` | `edit=ID` loads an article; `edit=new` plus an independent draft identifier isolates a new article |

The URL owns submitted conditions; the input component owns unsubmitted typing. Server entrypoints and clients share strict parsing. Search submissions, page changes and tabs push history; canonicalization and correction of a page emptied by deletion replace history. Returning from the form retains the source list conditions.

Request identity includes all active filters and page parameters. Delayed responses must not overwrite the current query. Browser back/forward and hard refresh restore conditions without breaking existing input focus, identity restoration or scroll return. A resource section empty on the current mixed page must not claim there are no matches when its total is nonzero.

## Automated acceptance

Implemented checks assert summary-only list SQL/JSON, public and administrator search JSON without bodies, body-only matches, protected detail access and existing cache boundaries. Component tests exercise fresh detail loading, failed/incomplete responses, retry, cancellation and late responses without accidental writes. Playwright inspects list/search server HTML, retries a failed detail request, saves the complete draft and rechecks public draft isolation. The existing browser workflows continue to cover publishing, identity/hard refresh, search input and scroll return. The remaining requirements below apply as the proposed query and navigation contracts are implemented.

Backend integration tests must assert omitted body/derived fields, protected details, permission isolation, all search scopes, exact per-kind/combined totals, strict combined limits at 1/10/100, ties, duplicate field matches, malformed parameters, empty/deep pages, literal wildcards, Chinese/short terms and concurrent-write snapshot consistency. Migration tests cover fixed legacy rows, repeat/concurrent/failure cases, identical backfill/write extraction and backup restoration with extensions.

Vitest tests cover summary/detail types and consumers, stale detail requests, retry and disabled-save behavior, shared URL parsing, grouped mixed results and out-of-range correction. Playwright covers direct editor entry, draft isolation, list/search HTML without body markers, all four list/search routes, forward/back/refresh and preserved scroll/input behavior. Rerun the original and long-body benchmarks on the same machine after implementation.
