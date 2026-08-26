# Database Migration, Backup, and Restore

Blog Studio treats schema changes, PostgreSQL data, and uploaded content as operational data. The API process never changes the schema. Run migrations explicitly before starting a backend release, and back up PostgreSQL and `UPLOAD_DIR` while application writes are stopped.

## Prerequisites

- `DB_DSN` must identify the intended PostgreSQL database.
- `pg_dump` and `pg_restore` must be installed. Use client tools from the same PostgreSQL major release as the server, or a newer supported client release.
- The operating-system account running maintenance commands needs read access to `UPLOAD_DIR` and write access to the chosen backup destination.
- Keep database and upload credentials in environment variables or the deployment secret store. Do not put them in command arguments, backup manifests, shell history, or repository files.

`PG_DUMP_PATH` and `PG_RESTORE_PATH` may point to explicit executables when the required tools are not on `PATH`. PostgreSQL connection values are parsed from the DSN and passed only through the maintenance subprocess environment; the password is never added to a process argument.

## Applying migrations

Run the migration command once before starting a new backend release:

```powershell
cd backend
go run ./cmd/migrate up
go run ./cmd/server
```

The migration runner:

- obtains a PostgreSQL transaction-level advisory lock, so concurrent migration processes wait instead of changing the schema together;
- creates and reads `blog_schema_migrations` as the version history;
- applies pending versions and records them in the same transaction as their schema changes;
- safely establishes the current schema on an empty database;
- normalizes and registers databases created by earlier application releases;
- succeeds without changing data when every version is already applied.

The API and seed commands only verify that the recorded schema is current. They fail with an instruction to run the migration command when a database is empty, pending, incompatible, or newer than the backend binary. Migrations are forward-only; take and verify a backup before applying a release that contains a new schema version.

## Creating a matched backup

Stop the API process and any other writer before starting. PostgreSQL itself must remain available. This maintenance window is what keeps the database snapshot and upload archive logically paired; the command cannot make concurrent filesystem and database writes atomic.

```powershell
cd backend
$env:DB_DSN = "host=localhost user=blog_app password=replace_me dbname=blog_db port=5432 sslmode=disable"
$env:UPLOAD_DIR = "uploads"
go run ./cmd/backup create D:\protected-backups
```

The command refuses to proceed when the migration history is not current or when file records and stored content are inconsistent. It writes into a private staging directory and publishes a timestamped bundle only after local verification succeeds:

```text
blog-studio-backup-YYYYMMDDTHHMMSSZ/
  database.dump
  uploads.tar.gz
  manifest.json
```

`database.dump` is a compressed PostgreSQL custom-format archive. `uploads.tar.gz` contains safe regular files from `UPLOAD_DIR`; symbolic links, nested directories, and unsafe names are rejected. `manifest.json` records the backup format, creation time, schema migration version, file counts, sizes, and SHA-256 checksums. It never records the source DSN or filesystem path.

After creation, verify the bundle again from its final storage location:

```powershell
go run ./cmd/backup verify D:\protected-backups\blog-studio-backup-YYYYMMDDTHHMMSSZ
```

Verification checks the manifest, artifact sizes, SHA-256 values, tar structure, uncompressed upload totals, and the PostgreSQL archive table of contents. A checksum detects corruption; it is not a digital signature. Store backups with restricted permissions, encrypt them at rest, and copy them off the application host according to the chosen retention policy.

## Isolated restore drill

Create a new empty PostgreSQL database whose name ends in `_restore`. Do not point the restore command at the active database. Select a target upload directory that does not exist yet.

```powershell
cd backend
$env:RESTORE_DB_DSN = "host=localhost user=blog_restore password=replace_me dbname=blog_db_restore port=5432 sslmode=disable"
$env:RESTORE_UPLOAD_DIR = "D:\restore-drill\uploads"

# Recommended additional guards against selecting active targets.
$env:DB_DSN = "host=localhost user=blog_app password=replace_me dbname=blog_db port=5432 sslmode=disable"
$env:UPLOAD_DIR = "D:\blog-data\uploads"

go run ./cmd/restore D:\protected-backups\blog-studio-backup-YYYYMMDDTHHMMSSZ
```

The restore command:

- verifies checksums and PostgreSQL archive readability before writing;
- requires a target database name ending in `_restore` and refuses the active database identity when `DB_DSN` is provided;
- requires an empty target database;
- refuses an existing target upload path and the active upload path when `UPLOAD_DIR` is provided;
- extracts uploads into a private sibling staging directory;
- runs `pg_restore` with `--single-transaction`, `--exit-on-error`, and no owner or privilege restoration;
- verifies the restored schema version;
- publishes the restored upload directory only after the database restore succeeds;
- verifies that every restored file record resolves to one stored file and that no stored files are orphaned.

The isolated database and upload directory are intentionally retained after a successful drill so they can be inspected through the API by temporarily pointing a stopped backend at those targets. Remove them manually only after the drill has been accepted. If a late verification fails, treat both isolated targets as disposable and investigate the reported mismatch before attempting another restore.

## Operational checklist

Before a release:

1. Stop application writes.
2. Create the matched backup bundle.
3. Verify the bundle from its retained destination.
4. Apply pending migrations.
5. Start the backend and check readiness and the administrator storage-health report.

For a restore drill:

1. Create a fresh `_restore` database and choose a new upload path.
2. Run the isolated restore command.
3. Start a stopped, separately configured backend against the isolated targets if application-level inspection is required.
4. Verify public reads, administrator reads, file previews, and downloads.
5. Record the backup identifier, elapsed time, verification result, and cleanup decision without recording credentials.

Docker Compose and VPS-specific execution are documented separately when those deployment artifacts are introduced. The commands in this document work with native development tools and are also exercised by the PostgreSQL integration suite in GitHub Actions.
