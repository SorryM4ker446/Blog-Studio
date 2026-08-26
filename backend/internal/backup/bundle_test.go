package backup

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakePostgresRunner struct {
	t              *testing.T
	databaseDSN    string
	databaseName   string
	dumpWasCreated bool
}

func (runner *fakePostgresRunner) Run(_ context.Context, _ string, args []string, environment []string) error {
	runner.t.Helper()
	wroteDump := false
	for _, argument := range args {
		if strings.Contains(argument, runner.databaseDSN) {
			runner.t.Fatal("database DSN was exposed in a command argument")
		}
		if strings.HasPrefix(argument, "--file=") {
			path := strings.TrimPrefix(argument, "--file=")
			if err := os.WriteFile(path, []byte("test PostgreSQL archive"), 0o600); err != nil {
				runner.t.Fatalf("write fake database archive: %v", err)
			}
			runner.dumpWasCreated = true
			wroteDump = true
		}
	}
	if wroteDump {
		foundDSN := false
		foundPassword := false
		for _, entry := range environment {
			if entry == "PGDATABASE="+runner.databaseName {
				foundDSN = true
			}
			if entry == "PGPASSWORD=not-a-real-secret" {
				foundPassword = true
			}
		}
		if !foundDSN {
			runner.t.Fatal("database DSN was not passed through PGDATABASE")
		}
		if strings.Contains(runner.databaseDSN, "not-a-real-secret") && !foundPassword {
			runner.t.Fatal("database password was not passed through PGPASSWORD")
		}
	}
	return nil
}

func TestCreateAndVerifyBundle(t *testing.T) {
	uploadDir := t.TempDir()
	files := map[string]string{
		"first.txt":  "first upload",
		"second.png": "second upload",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(uploadDir, name), []byte(content), 0o600); err != nil {
			t.Fatalf("write upload %q: %v", name, err)
		}
	}
	dsn := "host=database.invalid user=test password=not-a-real-secret dbname=backup_test"
	runner := &fakePostgresRunner{t: t, databaseDSN: dsn, databaseName: "backup_test"}
	createdAt := time.Date(2026, time.August, 26, 1, 2, 3, 0, time.UTC)
	bundleDir, err := Create(context.Background(), CreateOptions{
		DatabaseDSN:      dsn,
		UploadDir:        uploadDir,
		OutputDir:        t.TempDir(),
		MigrationVersion: 2026082601,
		PgDumpPath:       "fake-pg-dump",
		Runner:           runner,
		Now:              func() time.Time { return createdAt },
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if filepath.Base(bundleDir) != "blog-studio-backup-20260826T010203Z" {
		t.Fatalf("backup bundle name = %q", filepath.Base(bundleDir))
	}
	manifest, err := Verify(bundleDir)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if manifest.Uploads.FileCount != len(files) {
		t.Fatalf("upload file count = %d, want %d", manifest.Uploads.FileCount, len(files))
	}
	if manifest.MigrationVersion != 2026082601 || !manifest.CreatedAt.Equal(createdAt) {
		t.Fatalf("backup manifest metadata = %+v", manifest)
	}
	if err := VerifyDatabaseArchive(context.Background(), bundleDir, "fake-pg-restore", runner); err != nil {
		t.Fatalf("VerifyDatabaseArchive() error = %v", err)
	}
}

func TestVerifyDetectsArtifactTampering(t *testing.T) {
	uploadDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(uploadDir, "upload.txt"), []byte("upload"), 0o600); err != nil {
		t.Fatal(err)
	}
	dsn := "host=database.invalid user=test dbname=backup_test"
	runner := &fakePostgresRunner{t: t, databaseDSN: dsn, databaseName: "backup_test"}
	bundleDir, err := Create(context.Background(), CreateOptions{
		DatabaseDSN:      dsn,
		UploadDir:        uploadDir,
		OutputDir:        t.TempDir(),
		MigrationVersion: 2026082601,
		Runner:           runner,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	file, err := os.OpenFile(filepath.Join(bundleDir, DatabaseFileName), os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("tampered"); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(bundleDir); err == nil || !strings.Contains(err.Error(), "size is") {
		t.Fatalf("Verify() error = %v, want artifact size failure", err)
	}
}

func TestCreateRejectsUnexpectedUploadDirectories(t *testing.T) {
	uploadDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(uploadDir, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	dsn := "host=database.invalid user=test dbname=backup_test"
	runner := &fakePostgresRunner{t: t, databaseDSN: dsn, databaseName: "backup_test"}
	_, err := Create(context.Background(), CreateOptions{
		DatabaseDSN:      dsn,
		UploadDir:        uploadDir,
		OutputDir:        t.TempDir(),
		MigrationVersion: 2026082601,
		Runner:           runner,
	})
	if err == nil || !strings.Contains(err.Error(), "not a safe regular file") {
		t.Fatalf("Create() error = %v, want unsafe upload entry failure", err)
	}
}

func TestRestoreTargetValidation(t *testing.T) {
	activeDSN := "host=localhost port=5432 user=postgres dbname=blog_db"
	if err := validateRestoreDatabase(activeDSN, activeDSN); err == nil {
		t.Fatal("validateRestoreDatabase accepted the active database")
	}
	if err := validateRestoreDatabase("host=localhost port=5432 user=postgres dbname=blog_db_restore", activeDSN); err != nil {
		t.Fatalf("validateRestoreDatabase() error = %v", err)
	}
	activeUploads := t.TempDir()
	if _, err := validateRestoreUploadDir(activeUploads, activeUploads); err == nil {
		t.Fatal("validateRestoreUploadDir accepted an existing active directory")
	}
	targetUploads := filepath.Join(t.TempDir(), "isolated-uploads")
	resolved, err := validateRestoreUploadDir(targetUploads, activeUploads)
	if err != nil {
		t.Fatalf("validateRestoreUploadDir() error = %v", err)
	}
	if !strings.EqualFold(resolved, targetUploads) {
		t.Fatalf("resolved restore upload path = %q, want %q", resolved, targetUploads)
	}
}

func TestStorageReportError(t *testing.T) {
	if err := (StorageReport{}).Error(); err != nil {
		t.Fatalf("clean report error = %v", err)
	}
	err := (StorageReport{MissingRecordIDs: []uint{1}, OrphanKeys: []string{"orphan.txt"}}).Error()
	if err == nil || !strings.Contains(err.Error(), "1 database records") {
		t.Fatal("inconsistent report did not return an error")
	}
}
