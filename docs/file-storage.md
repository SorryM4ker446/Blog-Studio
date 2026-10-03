# File Upload and Storage Security

Blog Studio stores uploaded content behind database records and never exposes server filesystem paths through the API. The default local backend uses opaque random storage keys, while request handlers depend on a storage interface so another backend can be introduced without changing upload validation rules.

## Configuration

```env
UPLOAD_DIR=uploads
MAX_UPLOAD_BYTES=1073741824
```

`UPLOAD_DIR` may be relative to the backend process or absolute. Every read, write, quarantine, restore, and scan operation is confined to this directory. Symbolic links and nested storage keys are not treated as regular stored content.

`MAX_UPLOAD_BYTES` defaults to 1 GiB (1,073,741,824 bytes) and accepts values from 1 byte through 1 GiB. The backend limits the complete multipart request and independently limits bytes written to disk. Managed uploads also reject larger files before sending them. The backend places multipart temporary files in the private `.health/multipart` directory inside `UPLOAD_DIR`, rather than the container's memory-backed `/tmp`. It verifies this directory at startup and removes temporary files left by an interrupted process. The storage health report and backup archive exclude this private directory.

Container deployments read `MAX_UPLOAD_BYTES` from the host's `deploy/.env`. Automatic releases preserve that file, so an existing lower value must be changed there to `1073741824` before the new limit takes effect. The same applies to older `HTTP_READ_TIMEOUT` and `HTTP_WRITE_TIMEOUT` overrides when large uploads need more time.

## Accepted formats

The server uses file signatures and structured-content detection rather than trusting the multipart `Content-Type` header. An allowed extension must match the detected content.

- Images: JPEG, PNG, GIF, and WebP
- Documents: PDF, DOC, XLS, PPT, DOCX, XLSX, and PPTX
- Data and text: TXT, Markdown, CSV, and JSON
- Archives: ZIP

SVG and HTML documents, script or executable extensions, empty files, unsupported extensions, and extension/content mismatches are rejected. TXT is intentionally strict: content detected as CSV, JSON, HTML, SVG, XML, or a script must use an appropriate allowed format where one exists and is rejected when disguised with a `.txt` extension. New files receive a cryptographically random storage key; a sanitized original name is retained for download headers and type validation.

## File metadata and previews

Administrators provide a required display name and an optional description during a managed upload. Managed display names are limited to 25 characters and descriptions to 100 characters. The original filename remains available for downloads and type validation. Internal editor-image uploads retain the 255-character filename limit because they do not use the managed metadata form. Existing records were migrated with their original filename as the display name. Records with longer metadata remain readable, but their values must be shortened to the new limits before saving file details.

The managed upload dialog checks the selected extension before submission. It shows actual browser upload progress after Upload is pressed, then a processing label if the transfer finishes and the server still has not responded after a short delay. The dialog stays in place as progress or errors change. An unsupported extension, or a server-confirmed content/extension mismatch, disables Upload for that selected file; choose Replace to select another file. Other failed transfers retain their details and may be retried. The server remains the authority for content validation.

Display metadata can be changed without renaming the stored object or changing the original download filename:

```text
PUT /api/admin/files/:id
```

Public Drive, advanced search, and home-page search match only the effective file name. A custom display name supersedes the original filename; uploads without a custom name use the original filename as their display name when it fits the 25-character managed limit. Public search never matches descriptions. Administrator search uses the same effective-name rule and additionally matches descriptions. Selecting a file in Drive, advanced search, or the administrator list opens the same details dialog. Validated images render through the hardened view endpoint; formats that are always served as attachments show metadata and a download action instead of attempting an unsafe inline preview.

## Serving rules

- Only validated JPEG, PNG, GIF, and WebP content is eligible for an inline response.
- All other content is served as an attachment, including requests made through the view endpoint.
- Responses include `X-Content-Type-Options: nosniff`, a restrictive sandbox policy, and a safely encoded `Content-Disposition` filename.
- Legacy records are resolved only by a basename inside `UPLOAD_DIR`. An absolute database path outside that root is never opened.

## Deletion and reconciliation

Files referenced by article content, article summaries, or settings cannot be deleted and return `409 file_in_use`. Remove the reference first, then delete the file.

Reference checks use existence queries and stop after finding an article reference. Route tests compare deletion results with the previous count-based predicate, including draft and published content, summary-only and setting-only references, different IDs and incomplete path fragments. A database lookup failure returns `500 database_error` before any file content or database record is removed; deletion can be retried after the lookup recovers.

Deletion first moves content to a random quarantine key. If the database delete fails, the content is restored; after a successful database delete, the quarantine copy is removed.

Administrators can request a read-only reconciliation report:

```text
GET /api/admin/files/storage-health
```

The response lists database records whose content is missing and stored content without a database record. The endpoint never deletes or repairs content automatically.

## Operational notes

- A 1 GiB multipart upload may occupy about 1 GiB in `.health/multipart` while the final copy is written into `UPLOAD_DIR`. Allow at least twice the file size in free space on the upload volume per concurrent upload, plus room for existing files and backups. The temporary copy is not included in backup bundles; a restart removes interrupted temporary files.
- The default HTTP read and write timeouts are 30 minutes to allow large uploads over slower connections. Existing `HTTP_READ_TIMEOUT` and `HTTP_WRITE_TIMEOUT` environment overrides may need increasing; reverse proxies must also allow the request body and duration.
- Keep `UPLOAD_DIR` outside publicly served frontend directories.
- Give the backend process read and write access only to that directory.
- Back up the database and upload directory together while application writes are stopped; use the matched bundle and isolated restore procedure in [`backup-restore.md`](backup-restore.md).
- Review the storage health report before and after restoring a backup or migrating storage.
