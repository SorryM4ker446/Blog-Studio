# Data Integrity and API Rules

## Database migration

The API process does not modify the database schema. Operators run the versioned migration command before starting a backend release:

```text
go run ./cmd/migrate up
```

The runner obtains a PostgreSQL advisory lock, applies pending versions transactionally, and records them in `blog_schema_migrations`. The current baseline creates an empty database or safely normalizes a database created by earlier releases. It:

- converts legacy `category_id = 0` and dangling category references to `NULL`;
- normalizes unsupported post statuses to `draft`;
- backfills a missing publication time from `updated_at`, `created_at`, or the migration time;
- preserves first-publication history while clearing timestamps attached to invalid legacy statuses;
- creates the post/category foreign key, check constraints, and query indexes.

Repeated execution is idempotent. Concurrent commands serialize on the database lock, while the API and seed processes perform a read-only version check and refuse to start against an empty, pending, incompatible, or newer schema. Backup and isolated restore procedures are documented in [`backup-restore.md`](backup-restore.md).

## Domain rules

### Posts

- `title` and `content` are required. Titles are trimmed and limited to 255 characters.
- `status` is either `draft` or `published`.
- `published_at` records the first publication time. Editing, returning to draft, and publishing again never reset it.
- `last_edited_at` is `NULL` for a post that has not been edited since its first publication. Content or metadata saves after publication update it without changing `published_at`.
- Public lists and searches sort by `COALESCE(last_edited_at, published_at)`, while the administrator list continues to use the general GORM `updated_at` timestamp.
- `slug` is normalized to lowercase letters, numbers, Chinese characters, and hyphens, with a maximum of 255 characters.
- A missing slug is generated from the title. Conflicts use deterministic suffixes such as `-2` and `-3`.
- An explicitly supplied duplicate slug returns `409 Conflict`.
- `category_id` is nullable. The API accepts `0` as a compatibility input for “uncategorized” and stores it as `NULL`.

### Categories

- Names are trimmed, required, and limited to 50 characters.
- Names are unique without regard to case or surrounding whitespace.
- Deleting a category does not delete its posts. PostgreSQL atomically sets related `posts.category_id` values to `NULL` through `ON DELETE SET NULL`.

### Settings and files

- A settings update validates the complete request before writing and upserts all entries atomically.
- An upload removes the newly written disk file if its database record cannot be created.
- File deletion first moves disk content to a quarantine name. A failed database delete restores it; a successful delete removes the quarantined content.

File-type, file-size, path, content, serving, and reconciliation rules are documented in [`file-storage.md`](file-storage.md).

## API validation and responses

All API errors use this compatible shape:

```json
{
  "error": "Human-readable message",
  "code": "stable_machine_code"
}
```

Validation and malformed identifiers return `400`, missing resources return `404`, uniqueness conflicts return `409`, and unexpected database/storage failures return `500` without exposing driver errors.

Pagination uses `page` from 1 through 1,000,000 and `limit` from 1 through 100. Search text is trimmed and limited to 200 characters; `scope` is one of `posts`, `files`, or `all`. Sort and Boolean query values are allowlisted rather than silently coerced.

Successful resource creates and updates return the resource, list endpoints return their existing pagination envelope, and successful deletes or action endpoints return `{ "message": "..." }`.

Public pages display `Published on` with `published_at` until a post receives a post-publication edit. They then display `Updated on` with `last_edited_at`.
