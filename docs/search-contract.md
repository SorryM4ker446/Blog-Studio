# Search and Article Read Contract

Article summaries, protected administrator detail reads, normalized body search, bounded pagination and list URL state are implemented. Lists and search responses omit `content` and derived text. PostgreSQL filters searchable fields and produces exact totals plus one bounded summary page in a single statement. Editor form URLs, version conflicts and publication actions remain future editor work. Query evidence is in [query-analysis.md](query-analysis.md).

## Resource representations and access

| Representation | Fields and responsibility |
| --- | --- |
| `PostSummary` | `id, title, slug, summary, category_id, category, status, published_at, last_edited_at, created_at, updated_at`; never `content` or derived search text |
| `PostDetail` | Summary fields plus `content`; the later optimistic-concurrency implementation adds the administrator version token |
| Article write input | Explicit editable fields, separate from read types; version and publication actions follow the editor contract when implemented |
| File result | Existing public file metadata; no storage paths, bytes or credentials |

Ordinary lists use explicit SQL projection without `content`. Search uses `posts.search_text` for body matching and hydrates only the selected page with explicit summary columns; Markdown bodies are never loaded into Go for list or search requests. Public post detail stays `GET /api/posts/:id` and cannot reveal drafts, including when an administrator Cookie is supplied. `GET /api/admin/posts/:id` uses the existing authentication and administrator middleware and returns `Cache-Control: no-store`. Missing articles return `404 post_not_found`; unauthorized requests follow existing 401/403 behavior.

Editor now obtains the full article after clicking an edit action or a draft card. The form uses the fresh detail response for every editable field. Loading and failure states provide a way back to the list; failures can be retried, and no saveable form appears until a complete matching detail response arrives. Returning to the list or unmounting aborts the request and ignores late success/error responses. Creating a new draft does not request an existing article. List HTML and server-component props contain summaries only. Direct editor URLs remain proposed below.

Visible-text post-filtering has one owner, the backend. Clients retain body-only search matches returned as summaries without trying to filter them again. The shared backend Markdown AST extractor supplies both historical backfill and explicit create/content-update paths; clients perform no post-filtering. Saving, publication status selection and the existing return-to-list behavior are unchanged by the read split.

Removing `content` is a breaking response change for consumers that edit from list results. Deploy frontend and backend together, and reload already-open clients after upgrade. Search pagination also changes the default from all matches to a combined ten-result page. Deploy migration `2026090601` with operator-prepared `pg_trgm` in schema `public`; see [deployment.md](deployment.md). An image-only rollback across this migration is unsupported. No new application environment variable or service is required. Public detail and successful article write responses retain complete bodies; file endpoints keep their existing behavior.

## Paginated search request and response

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

Build candidate IDs with `UNION` to deduplicate article fields/category matches, then `UNION ALL` across resource kinds. A single SQL statement derives totals and the ordered page from one materialized candidate set. Totals, article summaries, category metadata and file metadata are hydrated by that same SQL statement. Separate READ COMMITTED queries would not supply the required shared snapshot.

The response arrays are grouped by kind, preserving each kind's relative order within the combined page. They do not encode cross-kind interleaving; the UI retains separate article/file sections and uses the shared page control. Writes between separate page requests can change results; offset pagination does not promise a historical snapshot across requests.

## Visible text and database consistency

The backend uses Goldmark with an AST traversal shared by migration backfill and every create/content-update path. The parser keeps HTML literal, supports tables and strikethrough, and handles image-size shortcut references supported by the browser renderer. Store derived **body-only** text, keeping title, summary and category matching separate so a query cannot span artificial field boundaries. Resolve category names live; category renames must immediately affect searches.

Extraction rules:

- Keep rendered prose, headings, list/quote text, code span/block text and visible link labels, including reference links and nested formatting.
- Remove complete images, including alt/title/source; remove link destinations, reference definitions, and bare/autolink HTTP(S) URLs, preserving the established search boundary.
- Decode text entities as rendered. Insert line boundaries between blocks; normalize CRLF to LF without stripping Chinese characters, punctuation or combining sequences.
- Match the current renderer's `html: false` behavior: raw HTML stays escaped literal text, with the same bare-URL exclusion; never execute or interpret it as active HTML. Retain visible text according to the supported Markdown syntax.
- Keep case-insensitive substring semantics; do not introduce stemming, fuzzy matching, ranking, accent folding or a minimum three-character query length.

Use parameterized PostgreSQL `ILIKE` consistently for candidate fields. Case behavior follows the database collation/ctype rather than an additional Go case-folding pass; ASCII case, Chinese and short substring behavior have explicit integration coverage. Locale-specific case folds are not portable across database collations. Chinese one-character and two-character queries remain valid even when a trigram index cannot accelerate them. Unicode and Markdown fixtures must cover hidden URLs, reference images, entities, nested links, fenced code, empty output, category renames and literal wildcard characters.

Golden fixtures cover entity decoding without double decoding, formatting, links and references, complete image removal, code, HTML literals and Unicode. The historical prototype still supplies known visible fixture text; production query checks and HTTP benchmarks now seed through the real extractor. Content updates synchronize `content` and `search_text` atomically; metadata-only updates retain the derived body, and clients cannot submit `search_text`.

Migration `2026090601` adds `search_text`, backfills 64 articles at a time, sets NOT NULL and creates the three verified read indexes. The initial migration uses frozen schema models, and a checked-in historical SQL fixture verifies upgrade independently of current models. Backfill preserves original Markdown and every article timestamp; failure rolls back data, schema and history together. Extension preconditions, rollback and matched backup tooling are specified in [query-analysis.md](query-analysis.md).

## URL and navigation state

| Page | Parameters | Transition |
| --- | --- | --- |
| All Posts | `q, category, page` | Search/clear/category changes reset page; paging preserves filters |
| Drive | `q, page` | Search/clear resets page; paging preserves query |
| Advanced search | `q, scope, category, page` | Default scope all; condition changes reset the shared page |
| Editor list | `tab, q, category, post_page, file_page` | Search/category changes reset active resource page; tab changes clear q/category and reset the destination page |
| Editor form (future) | List parameters plus `edit` | Planned direct article/new-draft entry; the current form still opens from the list |

The URL owns submitted conditions; the input component owns unsubmitted typing. Server entrypoints and clients share strict parsing. Invalid or duplicated recognized conditions normalize to defaults; empty q/category, page 1 and advanced-search scope all are omitted from canonical URLs. Editor tab defaults to posts and both resource page values are normalized. API malformed page/limit values still return stable 400 errors. Search submissions, page changes and tabs push history; canonicalization and correction of a page emptied by deletion replace history. Returning from the form retains the source list conditions.

Request identity includes all active filters and page parameters. Delayed responses must not overwrite the current query. Browser back/forward and hard refresh restore conditions without breaking existing input focus, identity restoration or scroll return. A resource section empty on the current mixed page must not claim there are no matches when its total is nonzero.

## Automated acceptance

Implemented checks assert summary-only list SQL/JSON, public and administrator search JSON without bodies, body-only matches, protected detail access and existing cache boundaries. Component tests exercise fresh detail loading, failed/incomplete responses, retry, cancellation and late responses without accidental writes. Playwright inspects list/search server HTML, retries a failed detail request, saves the complete draft and rechecks public draft isolation. The existing browser workflows continue to cover publishing, identity/hard refresh, search input and scroll return. Search pagination tests additionally exercise exact totals, per-kind scopes, wildcard escaping, stable ties and concurrent publication/system-file changes.

Backend integration tests assert omitted body/derived fields, protected details, permission isolation, all search scopes, exact per-kind/combined totals, strict combined limits at 1/10/100, ties, duplicate field matches, malformed parameters, empty/deep pages, literal wildcards, Chinese/short terms and concurrent-write snapshot consistency. Migration tests cover fixed legacy rows, repeat/concurrent/failure cases, identical backfill/write extraction and backup restoration with extensions.

Vitest tests cover summary/detail types and consumers, stale detail requests, retry and disabled-save behavior, shared URL parsing, grouped mixed results and out-of-range correction. Playwright covers direct editor list entry, draft isolation, list/search HTML without body markers, all four list/search routes, forward/back/refresh and preserved scroll/input behavior. Rerun the original and long-body benchmarks on the same machine after implementation.
