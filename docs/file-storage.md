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

SVG and HTML documents, script or executable extensions, empty files, unsupported extensions, and extension/content mismatches are rejected. New files receive a cryptographically random storage key; a sanitized original name is retained only for display and download headers.

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
