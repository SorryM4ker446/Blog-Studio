# Article editing and publication

The editor reads complete articles through authenticated `GET /api/admin/posts/:id`. Article details and successful writes include a positive `version`; list and search summaries remain body-free. Existing article URLs use `edit=ID`, while new articles use `edit=new`.

## Content list pagination

Both Posts and Files in Content Editor keep pagination in a bottom row. Page changes let the old cards exit before new cards enter with a short directional fade. The content area reserves the tallest page measured at the current width, so a short last page does not collapse the grid or pull pagination upward; resizing the available width resets that height reservation. Existing rows remain visible while loading; pagination rejects repeated clicks without fading or remounting. System reduced-motion preferences disable the result animation. Each resource retains its existing filters, page URL, history restoration and last-page correction after deletion.

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

Viewing uses the same browser recovery copies as other departures. Unsaved input prompts before leaving; on return, choose a copy to restore or discard it. The former temporary in-memory preview handoff has been removed, so there is one recovery source. The matching editor return URL and list filters are retained.

Publishing a new article first creates a draft, then publishes that ID and version. If publication fails after draft creation succeeds, the editor retains the draft ID and updates its URL, so a retry does not create another article. If the creation response itself is lost, the outcome is uncertain: check the content list before retrying creation. The client does not automatically repeat creation requests after network failures.

## Changes and conflicts

Dirty state compares title, introduction, Markdown and category with the last successfully loaded or saved snapshot. Restoring the original values clears the dirty state. Preview changes and category-list refreshes do not alter the snapshot. Unpublishing updates the saved status/version while retaining pending form edits, which remain dirty until saved.

On conflict, the current text stays in the form and write actions are disabled. `Load latest version` fetches the current server article without adopting it or sending a write. Review its title, timestamp and content; copy any local text you wish to keep. `Discard my edits and use latest` explicitly replaces the form and baseline. A further concurrent change will produce another conflict rather than silently overwrite it.

Article mutations and conflict-detail reads handle HTTP 401 locally to avoid redirecting away from entered text. Sign in in a new tab, return to the original editor and retry. This does not bypass server authentication, authorization or CSRF checks. Other protected requests retain the normal session-expiry behavior.

## Persistence and deployment boundaries

Migration `2026090901` adds `posts.version` and a PostgreSQL update trigger. Historical articles start at 1 without changing their content or timestamps. Every row update advances the version, including foreign-key updates when a category is deleted; these category changes do not rewrite article timeline timestamps. Conditional writes and response reloads run in one transaction, so a failed reload rolls back the write and its version change. The maximum supported version is JavaScript's maximum safe integer, 9007199254740991.

Deploy frontend and backend together, apply pending migrations before API startup, and reload old clients: writes without versions are incompatible. No new environment variable or extension is required beyond the existing search migration prerequisites. See [deployment](deployment.md) and [backup and restore](backup-restore.md); image-only rollback across a new migration is unsupported.

## Browser recovery copies

The browser stores unsaved title, introduction, Markdown and category fields in IndexedDB, together with a format version, user ID, article or new-draft identity, original saved fields/version, and timestamps. Copies expire after seven days. Writes are throttled to at most one per second during continuous input, with a best-effort flush on visibility loss, navigation and unload. The store permits at most 20 copies and 4 MiB of encoded copy data per origin. It rejects a write that would exceed these bounds rather than evicting another tab's unsaved work. Expired or malformed copies are removed during discovery; the editor reports skipped copies and storage failures. Storage failure never prevents manual server saving.

Existing article copies are offered only for that article and authenticated user. `edit=new` receives an independent `draft` URL identifier. New-article entry also offers this user's unfinished new drafts, so closing the original tab does not make them undiscoverable. Choosing one forks its fields into the current new-draft identity. Browser copies do not create articles or upload files. Referenced uploads may have been deleted independently; inspect previews and replace missing references before saving.

Each editing session writes a unique copy key. A sessionStorage ownership identifier survives same-tab reloads; Web Locks separate ownership when a tab is duplicated. Without Web Locks, a fresh document owner is used conservatively: copy keys remain isolated, but source copies from earlier documents require explicit discard rather than automatic same-tab cleanup. Restoring another tab's copy forks it; saving the fork keeps the source tab's copy. Saving an article clears this editor's copies and adopted copies from the same tab, while explicit discard removes the listed copies. Unpublishing preserves pending text and advances its recovery baseline to the returned version. Reverting fields to the saved snapshot also clears the current copy.

Restore and discard are explicit choices; neither writes an article to the server. A restored old version is never silently replaced with the latest version. When the version differs, the editor keeps the local text and enters the existing conflict review flow with the latest server content available for comparison. There is no automatic publishing, conflict merge or force overwrite.

The recovery panel follows the current light/dark theme, lists each copy's title and timestamp, and provides an individual Restore action and a separate discard action. The form remains locked while recovery choices are pending. Discard buttons stay locked until cleanup completes.

Successful logout cancels local pending writes, clears all of that user's copies for the origin and advances a persisted user generation. Other tabs receive a logout notification, clear their authenticated state and cancel pending recovery work; any old writer generation is refused even if notification is unavailable. Per-copy removal markers and serialized writer operations prevent delayed writes from resurrecting cleared records. Failed logout retains copies. Session expiry preserves the current copy before an application redirect; article write failures continue to offer signing in in another tab. Different users never receive each other's recovery choices.

These are unencrypted local working copies, accessible to scripts running on this origin and people with access to the browser profile. They contain no passwords, session Cookies or CSRF tokens, are not sent to the server by the recovery module, and are not included in server backups. Browser eviction, clearing site data, private browsing, unavailable storage and forced process termination can remove them. If local deletion fails after a confirmed server logout, the application warns that site data must be cleared before sharing the browser. Changing the site's scheme/host/port creates a different browser storage origin.

Closing all Incognito/InPrivate windows can discard the private session's IndexedDB, even when a recovery write has completed. Signing in again cannot restore that browser-local data. Save to the server before ending a private session if the changes must survive; use a normal persistent browser profile when testing recovery across browser restarts. See [IndexedDB storage and private browsing](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology).

## Leaving the editor

Dirty forms open a themed confirmation before returning to the content list, following ordinary same-tab links (including View article and sidebar links), application router navigation, and Back/Forward within application history. Stay in editor is focused initially; Tab cycles through the dialog buttons, and Escape cancels and restores focus without scrolling. Cancel keeps the form and framework history state. Repeated requests cannot replace the pending destination. Leave editor flushes browser recovery before replaying the chosen action; changing editors, session expiry or logout invalidates a pending decision and any late completion.

Stay in editor and Escape remain available while a recovery flush is pending. Cancelling invalidates that continuation, so slow storage cannot force a later departure.

The navigation module installs before hydration, adds only its own history position marker and preserves all router state fields. A guarded history traversal first returns to the current entry before opening the asynchronous confirmation, suppressing both tentative events from the router and scroll-restoration listeners. Acceptance replays the original traversal once; cancellation adds no synthetic history entry. New-tab/modifier-click links, downloads and same-document fragments retain their native behavior. Pending article writes block application departures until completion.

Collapsing or expanding the sidebar is a layout action: it does not navigate, prompt to leave, submit the article, or replace the editor. The sidebar keeps its navigation nodes mounted and uses a shared easing curve. When surrounding components wrap into new rows, a separate position-animation module softens the jump; it does not scale text or change article-body sizing rules. Motion can reverse before completion, is cleaned up on navigation, and is disabled by the system's reduced-motion preference. Browsers without the component animation API retain the CSS sidebar transition and normal responsive layout.

The editor detail frame uses a viewport-based width budget calculated from the expanded sidebar, capped at 1200px, in both sidebar states. Its header, recovery panel, fields and Markdown editor move together without changing width when the sidebar toggles. Changing the browser viewport can still resize the editor; article-body sizing rules are unchanged.

Refresh, tab closure and departures to another document use the browser's native unsaved-changes prompt. Websites cannot theme this browser UI or replace it with an asynchronous app dialog. Its wording and availability are browser-controlled and normally require prior interaction. Browsers can suppress prompts, especially on mobile or forced termination; asynchronous storage work is not guaranteed to finish during unload. Regular throttled copies reduce this risk but are not a zero-loss backup guarantee. Application program navigation must use `useEditorRouter` or pass the intended continuation to `requestEditorNavigation`; external scripts that bypass these entry points are outside the application contract.

## Frontend deployment

This recovery change adds no backend endpoint, schema migration, environment variable or service. The existing frontend build includes `instrumentation-client.ts`; deploy the rebuilt frontend and reload older open clients to activate recovery and navigation protection. Existing server version checks remain required. IndexedDB's schema version and each record's format version are independent of article versions. Unsupported or malformed records are never restored.
