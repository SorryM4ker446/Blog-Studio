# Search and Article Read Contract

Article summaries, protected administrator detail reads, normalized body search, bounded pagination and list URL state are implemented. Lists and search responses omit `content` and derived text. PostgreSQL filters searchable fields and produces exact totals plus one bounded summary page in a single statement. Editor form URLs, version conflicts and explicit publication actions are implemented; see [article editing](editor.md). Query evidence is in [query-analysis.md](query-analysis.md).

## Resource representations and access

| Representation | Fields and responsibility |
| --- | --- |
| `PostSummary` | `id, title, slug, summary, category_id, category, status, published_at, last_edited_at, created_at, updated_at`; never `content` or derived search text |
| `PostDetail` | Summary fields plus `content` and the positive `version` token |
| Article write input | Explicit editable fields, separate from read types; existing-article writes require `version` and publication uses dedicated actions |
| File result | Existing public file metadata; no storage paths, bytes or credentials |

Ordinary lists use explicit SQL projection without `content`. Search uses `posts.search_text` for body matching and hydrates only the selected page with explicit summary columns; Markdown bodies are never loaded into Go for list or search requests. Public post detail stays `GET /api/posts/:id` and cannot reveal drafts, including when an administrator Cookie is supplied. `GET /api/admin/posts/:id` uses the existing authentication and administrator middleware and returns `Cache-Control: no-store`. Missing articles return `404 post_not_found`; unauthorized requests follow existing 401/403 behavior.

Editor obtains the full article after clicking an edit action, a draft card or opening an `edit=ID` URL. The form uses the fresh detail response for every editable field. Loading and failure states provide a way back to the list; failures can be retried, and no saveable form appears until a complete matching detail response arrives. Returning to the list, changing the URL target or unmounting aborts the detail request and ignores late success/error responses. Creating a new draft does not request an existing article. List HTML and server-component props contain summaries only. Direct editor entry and refresh load the protected article on the server and hydrate the matching form in place. Missing or failed initial details use the cancellable loader and retry path.

Visible-text post-filtering has one owner, the backend. Clients retain body-only search matches returned as summaries without trying to filter them again. The shared backend Markdown AST extractor supplies both historical backfill and explicit create/content-update paths; clients perform no post-filtering. An ordinary Save keeps the current article editor open regardless of publication status; only a successful Publish returns to Content Editor. Publication changes use dedicated actions; browser recovery copies and leave protection are described in [editor.md](editor.md).

Removing `content` is a breaking response change for consumers that edit from list results. Deploy frontend and backend together, and reload already-open clients after upgrade. The search API defaults to a combined ten-result page. Advanced search uses separate scoped requests to show up to ten posts and ten files, each with its own pagination. Apply all pending migrations, including search migration `2026090601` and article-version migration `2026090901`, with operator-prepared `pg_trgm` in schema `public`; see [deployment.md](deployment.md). An image-only rollback across this migration is unsupported. Public detail and successful article write responses retain complete bodies; file endpoints keep their existing behavior.

The public `GET /api/categories` response contains only categories with at least one published post, and its `post_count` counts published posts. Administrator category responses continue to include categories used only by drafts so the editor can manage them. Public search category options use this response, so draft-only category names are not exposed.

Search keeps existing results visible during filter requests. Advanced-search pagination stays mounted during requests and blocks repeated clicks without changing its displayed boundary opacity. It has no mount/fade animation. On desktop widths of at least 1100px, previous/next arrows sit beside each result list while page numbers remain below; narrower viewports use the bottom row. After a result page arrives, the changed section completes a short exit before committing the incoming cards and their directional entrance. List height adjusts with the incoming page; Content Editor reserves a complete page from the configured card rows, gaps and responsive column count, including a directly opened short last page; it does not need prior measurements or browser storage. Scope changes retain the outgoing result area at normal opacity while the request is pending. Once the current response arrives, an upward exit with easing into transparency is followed by a slower entrance from just below; the result swap happens only after the exit completes. This avoids a separate dimming pulse before the actual switch. Outgoing results are inert during the switch; filters stay available, and a newer selection cancels the previous transition. Scope changes own the entire transition: a simultaneous page reset does not trigger a second nested pagination animation, and existing pagination nodes remain mounted. Failed scope requests reveal the retry state instead of leaving results dimmed or blocked. All Posts and Cloud Drive keep arrows and page numbers together in a bottom row at every viewport size. They share the result transition and pending-control stability with advanced search. Advanced-search Files uses the same side-arrow presentation as its Posts section. Reduced-motion preferences disable both scope and page transitions. Search and editor category controls share the themed keyboard dropdown, whose highlighted option stays inside the menu's scroll area. An unavailable category from an old URL is displayed as `Unavailable category`, with an invalid-selection accessibility state and no private category name. The URL and request retain that filter until the user chooses another option; choosing `All categories` clears it and returns to the first page.

Article saves and publication retain the editor URL and input guarantees described in [editor.md](editor.md#explicit-actions).

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

The response arrays are grouped by kind, preserving each kind's relative order within the combined page. They do not encode cross-kind interleaving. Advanced search requests `scope=posts` and `scope=files` concurrently with `limit=10` when its selected scope is all. Each visible section has its own total and page control, so one kind cannot occupy the other kind's result slots. A single-kind scope requests and displays only that section. The article category control is shown and applied only in Posts scope. Switching to all or files clears the category condition; direct URLs in those scopes also normalize away `category`. Browser history can restore a previous Posts entry with its category. When the control appears, its label and dropdown slide in and fade in together over 220ms; reduced-motion preferences show it immediately. The search API continues to accept category filters with its existing semantics. Each scoped response still has an internally consistent snapshot; the two sections are independent reads and do not promise a shared cross-kind snapshot. If a request fails, the page offers retry rather than claiming zero matches. Writes between separate page requests can change results; offset pagination does not promise a historical snapshot across requests.

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
| Advanced search | `q, scope, category, post_page, file_page` | Default scope all; each section pages independently; query/scope/category changes reset both pages |
| Editor list | `tab, q, category, post_page, file_page` | Search/category changes reset active resource page; tab changes clear q/category and reset the destination page |
| Editor form | List parameters plus `edit=ID` or `edit=new` | Opening pushes history; draft creation replaces `new` with the returned ID; explicit return and successful publication remove `edit` using replace history; ordinary saves retain the article target |

The URL owns submitted conditions; the input component owns unsubmitted typing. Server entrypoints and clients share strict parsing. Invalid or duplicated recognized conditions normalize to defaults; empty q/category, page 1 and advanced-search scope all are omitted from canonical URLs. Editor tab defaults to posts and both resource page values are normalized. Advanced search also omits first pages and inactive resource pages. Legacy advanced-search `page=N` links remain accepted: the value supplies each active section's page unless an explicit section page is present, then canonicalization replaces `page` with the separate page parameters. Exhausted pages are corrected independently, without resetting the other section or adding a history entry. API malformed page/limit values still return stable 400 errors. Search submissions, page changes and tabs push history; canonicalization and correction of a page emptied by deletion replace history. Returning from the form retains the source list conditions.

Request identity includes all active filters and page parameters. Delayed responses must not overwrite the current query. Browser back/forward and hard refresh restore conditions without breaking existing input focus, identity restoration or scroll return. An empty resource section must not claim there are no matches when its total is nonzero.

The article editor target is restored on reload and browser history traversal, independently of whether the article appears on the current filtered list page. Only a positive safe-integer ID or `new` is accepted; repeated/invalid values select the list, and article targets are ignored on the files tab. Missing articles keep a retryable detail error and a return action. A URL target change invalidates pending save callbacks as well as detail requests. Initial query normalization waits until the router's history integration is installed and skips writes after a newer navigation, preserving the original history entry for browser Back.

Reload loads the server's last saved article and offers any matching browser recovery copies through an explicit restore/discard choice. `edit=new` has an independent `draft` identifier until saving replaces it with the server ID. The URL carries identity and list conditions; unsaved fields live in browser recovery storage, as described in [editor.md](editor.md).

## Automated acceptance

See [regression coverage](testing.md#regression-coverage) for API, migration, URL, browser and concurrency checks. [Query analysis](query-analysis.md) and [performance measurements](performance-baseline.md) record the SQL and end-to-end read comparisons, including fixture and platform limits.
