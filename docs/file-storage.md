# File Upload and Storage Security

Blog Studio stores uploaded content behind database records and never exposes server filesystem paths through the API. The default local backend uses opaque random storage keys, while request handlers depend on a storage interface so another backend can be introduced without changing upload validation rules.

## Configuration

```env
UPLOAD_DIR=uploads
MAX_UPLOAD_BYTES=10485760
```

`UPLOAD_DIR` may be relative to the backend process or absolute. Every read, write, quarantine, restore, and scan operation is confined to this directory. Symbolic links and nested storage keys are not treated as regular stored content.

`MAX_UPLOAD_BYTES` defaults to 10 MiB and accepts values from 1 byte through 100 MiB. The backend limits the complete multipart request and independently limits bytes written to disk.

## Accepted formats

The server uses file signatures and structured-content detection rather than trusting the multipart `Content-Type` header. An allowed extension must match the detected content.

- Images: JPEG, PNG, GIF, and WebP
- Documents: PDF, DOC, XLS, PPT, DOCX, XLSX, and PPTX
- Data and text: TXT, Markdown, CSV, and JSON
- Archives: ZIP

SVG and HTML documents, script or executable extensions, empty files, unsupported extensions, and extension/content mismatches are rejected. TXT is intentionally strict: content detected as CSV, JSON, HTML, SVG, XML, or a script must use an appropriate allowed format where one exists and is rejected when disguised with a `.txt` extension. New files receive a cryptographically random storage key; a sanitized original name is retained for download headers and type validation.

## File metadata and previews

Administrators provide a required display name and an optional description during a managed upload. Display names are limited to 255 characters and descriptions to 500 characters. Existing records are migrated with their original filename as the display name.

Display metadata can be changed without renaming the stored object or changing the original download filename:

```text
PUT /api/admin/files/:id
```

Public Drive, advanced search, and home-page search match only the effective file name. A custom display name supersedes the original filename; uploads without a custom name use the original filename as their display name. Public search never matches descriptions. Administrator search uses the same effective-name rule and additionally matches descriptions. Selecting a file in Drive, advanced search, or the administrator list opens the same details dialog. Validated images render through the hardened view endpoint; formats that are always served as attachments show metadata and a download action instead of attempting an unsafe inline preview.

## Serving rules

- Only validated JPEG, PNG, GIF, and WebP content is eligible for an inline response.
- All other content is served as an attachment, including requests made through the view endpoint.
- Responses include `X-Content-Type-Options: nosniff`, a restrictive sandbox policy, and a safely encoded `Content-Disposition` filename.
- Legacy records are resolved only by a basename inside `UPLOAD_DIR`. An absolute database path outside that root is never opened.

## Deletion and reconciliation

Files referenced by article content, article summaries, or settings cannot be deleted and return `409 file_in_use`. Remove the reference first, then delete the file.

Deletion first moves content to a random quarantine key. If the database delete fails, the content is restored; after a successful database delete, the quarantine copy is removed.

Administrators can request a read-only reconciliation report:

```text
GET /api/admin/files/storage-health
```

The response lists database records whose content is missing and stored content without a database record. The endpoint never deletes or repairs content automatically.

## Operational notes

- Keep `UPLOAD_DIR` outside publicly served frontend directories.
- Give the backend process read and write access only to that directory.
- Back up the database and upload directory together so record/content pairs remain consistent.
- Review the storage health report before and after restoring a backup or migrating storage.
