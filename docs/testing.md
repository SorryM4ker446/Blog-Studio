# Automated Testing

Blog Studio uses an isolated PostgreSQL database for integration and browser tests. Test tooling refuses to connect unless the configured database name ends in `_test`.

## Test database

Create a dedicated database such as `blog_db_test`. Never point `TEST_DB_DSN` at the development database `blog_db`.

PowerShell example:

```powershell
$env:TEST_DB_DSN = "host=localhost user=postgres password=your_password dbname=blog_db_test port=5432 sslmode=disable TimeZone=Asia/Shanghai"
```

The integration test helper validates the database name before running `TRUNCATE`. The Playwright setup resets this isolated database and creates a test-only administrator before every run.

## Backend tests

Run all Go tests:

```powershell
cd backend
go test ./...
```

Run the integration tests with detailed output:

```powershell
go test -v ./internal/routes
```

When `TEST_DB_DSN` is absent, PostgreSQL integration tests are skipped. CI always supplies it, so the integration tests are mandatory there.

## Frontend unit and component tests

Run the deterministic frontend test suite once:

```powershell
cd frontend
npm run test:unit
```

Use watch mode while developing frontend behavior:

```powershell
npm run test:unit:watch
```

Vitest and React Testing Library cover pure data transformations and focused client-component behavior in a `jsdom` environment. Browser-dependent layout, computed styles, file downloads, image loading, navigation, and complete user workflows remain Playwright responsibilities.

## Browser workflow test

Install the Chromium browser once:

```powershell
cd frontend
npx playwright install chromium
```

Run the E2E workflow:

```powershell
npm run test:e2e
```

Playwright starts isolated backend and frontend servers on ports `18080` and `3100`. The browser suite covers the HttpOnly Cookie login flow, server-rendered identity restoration without a hydration loading shell, login-to-home navigation, CSRF-protected mutations, draft creation, public draft isolation, publishing, public visibility, logout-to-home navigation, server-side logout invalidation, and protected-editor redirection. It also exercises the complete uploaded-image lifecycle: choose a real image, provide display metadata, upload and preview it, edit its name and description, verify the updated preview is public in Drive, reference it from a published post, keep deletion retryable after a simulated temporary storage failure, verify deletion is blocked and explained while referenced, confirm the `file_in_use` state disables repeated deletion without changing the dialog or reloading the file list, remove the reference, and then delete the file successfully. File cards, upload controls, metadata fields, preview surfaces, and primary actions are checked in both dark and light themes as part of this workflow. Layout assertions keep the upload icon centered, prevent long names from overlapping actions, preserve the public file name-and-metadata stack, keep post and file edit actions visually identical, and confirm that an outdated backend response remains retryable with an actionable message.

On failure, inspect `frontend/test-results` or open the saved trace:

```powershell
npx playwright show-trace test-results/<result-directory>/trace.zip
```

## Continuous integration

GitHub Actions creates a disposable `blog_db_test` PostgreSQL service. The frontend job runs linting, unit and component tests, and a production build. The backend job runs the Go integration tests, while the E2E job installs Chromium and runs the Playwright workflow. Failure screenshots, video, trace, and HTML reports are retained as workflow artifacts for seven days.

The backend integration suite additionally verifies login throttling, password policy, CSRF rejection, session invalidation, JWT signature/algorithm checks, and the production CORS allowlist.

Data integrity integration coverage verifies pagination and search boundaries, stable API error codes, post validation, slug conflict handling, immutable first-publication timestamps, post-publication edit timestamps and effective timeline ordering, category deletion with `ON DELETE SET NULL`, database check/foreign-key constraints, case-insensitive category uniqueness, missing-resource deletes, and atomic settings validation.

File storage coverage verifies strict TXT detection, active or structured content disguised as text, extension/content mismatches, empty and oversized uploads, random storage keys, path confinement, symlink rejection, safe response headers, forced attachment handling, effective-name and description search boundaries, metadata editing without changing original filenames, referenced-file deletion protection, deletion compensation, and read-only missing/orphaned content reports. Browser coverage additionally verifies Drive and advanced-search name precedence, public description isolation, administrator description search, home-to-advanced-search navigation, file preview from search results, and URL-backed query restoration after opening a post and returning from Drive, advanced search, All Posts, or Editor.

Runtime coverage verifies liveness and readiness semantics, dependency timeouts, shutdown readiness, writable-storage probes, request ID validation, route-template access logging, panic recovery, and sensitive structured-log attribute redaction.
