# Article editing and publication

The editor reads complete articles through authenticated `GET /api/admin/posts/:id`. Article details and successful writes include a positive `version`; list and search summaries remain body-free. Existing article URLs use `edit=ID`, while new articles use `edit=new`.

## Explicit actions

| Action | Request | Behavior |
| --- | --- | --- |
| Create a draft | `POST /api/admin/posts` with title, content and optional editable fields | Always creates a draft at version 1; requesting published status is rejected |
| Save | `PUT /api/admin/posts/:id` with `version` and editable fields | Saves content without changing publication status |
| Publish | `POST /api/admin/posts/:id/publish` with `version` and optional editable fields | Atomically saves supplied fields and publishes a draft |
| Draft (withdraw publication) | `POST /api/admin/posts/:id/unpublish` with only `version` | Withdraws publication without saving pending form edits |

All actions require administrator authentication and CSRF protection. Ordinary updates reject a supplied `status`; use the dedicated action endpoints. Category ID `0` clears the category. Missing, fractional, negative or otherwise invalid versions return HTTP 400. Unknown resources return 404. A stale version returns HTTP 409 with `code: post_version_conflict`; an incompatible publication state returns 409 with `code: post_state_conflict`. Clients must not automatically retry conflicting writes or substitute a newer version into an old payload.

The form displays a compact publication badge and separate `Save` and `Publish`/`Draft` controls. Enter submits an ordinary save. `Save` always stays in the current editor, for both drafts and published articles; only a successful `Publish` returns to Content Editor. `Draft` withdraws publication through the existing unpublish API and remains in the editor. Pending writes lock editable controls and duplicate submissions. The Save button keeps its label, dimensions, colors and opacity throughout the request; a separate live status reports progress. Saved timestamps and a compact diagonal-arrow link for published articles remain available. The link retains the accessible name and hover title `View article`, with no persistent text label.

`View article` opens in the current tab. Its URL carries a local `returnTo` editor URL matching the article ID, preserving the source list filters. The page Back button returns directly to that editor; browser Back also returns through history. Return targets outside the matching editor are rejected. Ordinary article links retain history-based return, with All Posts as the fallback when no history exists.

Before viewing, the editor keeps one in-memory snapshot for the current user/article, including unsaved fields and the original saved version. Returning in the same tab restores those edits; it does not save them to the server or silently adopt a newer version. The snapshot is consumed on editor entry, expires after 30 minutes, and is cleared on identity changes/logout. It does not use localStorage or sessionStorage and does not survive a full-page reload or tab closure. After a reload, the return URL still opens the matching editor, which loads the server's saved content. This limited viewing handoff is not the planned browser recovery-copy feature.

Publishing a new article first creates a draft, then publishes that ID and version. If publication fails after draft creation succeeds, the editor retains the draft ID and updates its URL, so a retry does not create another article. If the creation response itself is lost, the outcome is uncertain: check the content list before retrying creation. The client does not automatically repeat creation requests after network failures.

## Changes and conflicts

Dirty state compares title, introduction, Markdown and category with the last successfully loaded or saved snapshot. Restoring the original values clears the dirty state. Preview changes and category-list refreshes do not alter the snapshot. Unpublishing updates the saved status/version while retaining pending form edits, which remain dirty until saved.

On conflict, the current text stays in the form and write actions are disabled. `Load latest version` fetches the current server article without adopting it or sending a write. Review its title, timestamp and content; copy any local text you wish to keep. `Discard my edits and use latest` explicitly replaces the form and baseline. A further concurrent change will produce another conflict rather than silently overwrite it.

Article mutations and conflict-detail reads handle HTTP 401 locally to avoid redirecting away from entered text. Sign in in a new tab, return to the original editor and retry. This does not bypass server authentication, authorization or CSRF checks. Other protected requests retain the normal session-expiry behavior.

## Persistence and deployment boundaries

Migration `2026090901` adds `posts.version` and a PostgreSQL update trigger. Historical articles start at 1 without changing their content or timestamps. Every row update advances the version, including foreign-key updates when a category is deleted; these category changes do not rewrite article timeline timestamps. Conditional writes and response reloads run in one transaction, so a failed reload rolls back the write and its version change. The maximum supported version is JavaScript's maximum safe integer, 9007199254740991.

Deploy frontend and backend together, apply pending migrations before API startup, and reload old clients: writes without versions are incompatible. No new environment variable or extension is required beyond the existing search migration prerequisites. See [deployment](deployment.md) and [backup and restore](backup-restore.md); image-only rollback across a new migration is unsupported.

Browser recovery copies and comprehensive leave protection are not yet implemented. Refresh restores the server's last saved article, not unsaved input. The dirty indicator alone does not prevent navigation, refresh or closing a tab. There is no automatic publishing, automatic conflict merge, or force-overwrite action.
