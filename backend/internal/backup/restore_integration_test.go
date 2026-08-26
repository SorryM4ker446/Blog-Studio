package backup

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"blog-backend/internal/migrations"
	"blog-backend/internal/models"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestBackupRestoresDatabaseAndUploadsIntoIsolatedTargets(t *testing.T) {
	baseDSN := strings.TrimSpace(os.Getenv("TEST_DB_DSN"))
	if baseDSN == "" {
		t.Skip("TEST_DB_DSN is not configured; skipping backup and restore integration test")
	}
	parsed, err := pgx.ParseConfig(baseDSN)
	if err != nil {
		t.Fatalf("parse TEST_DB_DSN: %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(parsed.Database), "_test") {
		t.Fatalf("refusing to use non-test database %q", parsed.Database)
	}
	for _, executable := range []string{"pg_dump", "pg_restore"} {
		if _, err := exec.LookPath(executable); err != nil {
			t.Fatalf("%s is required for backup integration tests: %v", executable, err)
		}
	}

	randomBytes := make([]byte, 6)
	if _, err := rand.Read(randomBytes); err != nil {
		t.Fatalf("generate temporary database names: %v", err)
	}
	suffix := hex.EncodeToString(randomBytes)
	sourceName := "blog_backup_" + suffix + "_test"
	targetName := "blog_backup_" + suffix + "_restore"
	admin, err := gorm.Open(postgres.Open(baseDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	temporaryNames := []string{sourceName, targetName}
	t.Cleanup(func() {
		for _, name := range temporaryNames {
			if err := admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS "%s" WITH (FORCE)`, name)).Error; err != nil {
				t.Errorf("drop temporary database %q: %v", name, err)
			}
		}
		if sqlDB, sqlErr := admin.DB(); sqlErr == nil {
			_ = sqlDB.Close()
		}
	})
	for _, name := range temporaryNames {
		if err := admin.Exec(fmt.Sprintf(`CREATE DATABASE "%s"`, name)).Error; err != nil {
			t.Fatalf("create temporary database %q: %v", name, err)
		}
	}

	sourceDSN, err := replaceDatabaseName(baseDSN, sourceName)
	if err != nil {
		t.Fatalf("build source database DSN: %v", err)
	}
	targetDSN, err := replaceDatabaseName(baseDSN, targetName)
	if err != nil {
		t.Fatalf("build target database DSN: %v", err)
	}
	sourceDB, err := gorm.Open(postgres.Open(sourceDSN), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open source database: %v", err)
	}
	sourceSQLDB, err := sourceDB.DB()
	if err != nil {
		t.Fatalf("access source database connection: %v", err)
	}
	defer sourceSQLDB.Close()
	if err := migrations.Apply(context.Background(), sourceDB); err != nil {
		t.Fatalf("migrate source database: %v", err)
	}
	setting := models.Setting{Key: "site_title", Value: "Restore fixture"}
	if err := sourceDB.Create(&setting).Error; err != nil {
		t.Fatalf("create source setting: %v", err)
	}
	uploadDir := t.TempDir()
	storageKey := "restore-fixture.txt"
	content := []byte("database and upload content stay paired")
	if err := os.WriteFile(filepath.Join(uploadDir, storageKey), content, 0o600); err != nil {
		t.Fatalf("create source upload: %v", err)
	}
	fileRecord := models.File{
		Name:        storageKey,
		OrigName:    storageKey,
		DisplayName: "Restore fixture",
		Path:        storageKey,
		Size:        int64(len(content)),
		MimeType:    "text/plain",
	}
	if err := sourceDB.Create(&fileRecord).Error; err != nil {
		t.Fatalf("create source file record: %v", err)
	}
	report, err := CheckStorageConsistency(sourceDB, uploadDir)
	if err != nil || !report.IsClean() {
		t.Fatalf("source storage report = %+v, error = %v", report, err)
	}
	orphanPath := filepath.Join(uploadDir, "orphan.txt")
	if err := os.WriteFile(orphanPath, []byte("orphan"), 0o600); err != nil {
		t.Fatalf("create orphan fixture: %v", err)
	}
	report, err = CheckStorageConsistency(sourceDB, uploadDir)
	if err != nil || len(report.OrphanKeys) != 1 {
		t.Fatalf("orphan storage report = %+v, error = %v", report, err)
	}
	if err := os.Remove(orphanPath); err != nil {
		t.Fatalf("remove orphan fixture: %v", err)
	}
	missingPath := filepath.Join(uploadDir, storageKey+".missing")
	if err := os.Rename(filepath.Join(uploadDir, storageKey), missingPath); err != nil {
		t.Fatalf("hide upload fixture: %v", err)
	}
	report, err = CheckStorageConsistency(sourceDB, uploadDir)
	if err != nil || len(report.MissingRecordIDs) != 1 {
		t.Fatalf("missing-content storage report = %+v, error = %v", report, err)
	}
	if err := os.Rename(missingPath, filepath.Join(uploadDir, storageKey)); err != nil {
		t.Fatalf("restore upload fixture: %v", err)
	}

	bundleDir, err := Create(context.Background(), CreateOptions{
		DatabaseDSN:      sourceDSN,
		UploadDir:        uploadDir,
		OutputDir:        t.TempDir(),
		MigrationVersion: migrations.CurrentVersion(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := VerifyDatabaseArchive(context.Background(), bundleDir, "", nil); err != nil {
		t.Fatalf("VerifyDatabaseArchive() error = %v", err)
	}
	targetUploadDir := filepath.Join(t.TempDir(), "restored-uploads")
	if err := Restore(context.Background(), RestoreOptions{
		BundleDir:                bundleDir,
		TargetDatabaseDSN:        targetDSN,
		TargetUploadDir:          targetUploadDir,
		ActiveDatabaseDSN:        sourceDSN,
		ActiveUploadDir:          uploadDir,
		ExpectedMigrationVersion: migrations.CurrentVersion(),
	}); err != nil {
		t.Fatalf("Restore() error = %v", err)
	}

	targetDB, err := gorm.Open(postgres.Open(targetDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open restored database: %v", err)
	}
	targetSQLDB, err := targetDB.DB()
	if err != nil {
		t.Fatalf("access restored database connection: %v", err)
	}
	defer targetSQLDB.Close()
	if err := migrations.VerifyCurrent(context.Background(), targetDB); err != nil {
		t.Fatalf("verify restored migrations: %v", err)
	}
	var restoredSetting models.Setting
	if err := targetDB.Where("key = ?", setting.Key).First(&restoredSetting).Error; err != nil {
		t.Fatalf("load restored setting: %v", err)
	}
	if restoredSetting.Value != setting.Value {
		t.Fatalf("restored setting value = %q, want %q", restoredSetting.Value, setting.Value)
	}
	restoredContent, err := os.ReadFile(filepath.Join(targetUploadDir, storageKey))
	if err != nil {
		t.Fatalf("read restored upload: %v", err)
	}
	if string(restoredContent) != string(content) {
		t.Fatalf("restored upload content = %q, want %q", restoredContent, content)
	}
	report, err = CheckStorageConsistency(targetDB, targetUploadDir)
	if err != nil || !report.IsClean() {
		t.Fatalf("restored storage report = %+v, error = %v", report, err)
	}
}

var dbNamePattern = regexp.MustCompile(`(?i)(^|\s)dbname=(?:'[^']*'|\S+)`)

func replaceDatabaseName(dsn, databaseName string) (string, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		parsed.Path = "/" + databaseName
		return parsed.String(), nil
	}
	if dbNamePattern.MatchString(dsn) {
		return dbNamePattern.ReplaceAllString(dsn, "${1}dbname="+databaseName), nil
	}
	return strings.TrimSpace(dsn) + " dbname=" + databaseName, nil
}
