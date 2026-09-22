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
	"blog-backend/internal/searchtext"
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
	if err := sourceDB.Exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`).Error; err != nil {
		t.Fatal("prepare source extension")
	}
	if err := migrations.Apply(context.Background(), sourceDB); err != nil {
		t.Fatalf("migrate source database: %v", err)
	}
	setting := models.Setting{Key: "site_title", Value: "Restore fixture"}
	post := models.Post{Title: "Restore article", Slug: "restore-search", Content: "**restoredneedle** ![hidden](image.png)", Status: "draft"}
	post.SearchText = searchtext.Extract(post.Content)
	if err := sourceDB.Create(&post).Error; err != nil {
		t.Fatal("create source article")
	}
	if err := sourceDB.Create(&setting).Error; err != nil {
		t.Fatalf("create source setting: %v", err)
	}
	link := models.Link{Title: "Restored shortcut", Description: "Persisted homepage link", URL: "https://example.org/restored", Icon: "book", Color: "green", Visible: true, Position: 7, Version: 3, RequestID: "restore-link-fixture"}
	if err := sourceDB.Create(&link).Error; err != nil {
		t.Fatalf("create source link: %v", err)
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
	var restoredLink models.Link
	if err := targetDB.First(&restoredLink, link.ID).Error; err != nil {
		t.Fatalf("load restored link: %v", err)
	}
	if restoredLink.Title != link.Title || restoredLink.Description != link.Description || restoredLink.URL != link.URL || restoredLink.Icon != link.Icon || restoredLink.Color != link.Color || restoredLink.Visible != link.Visible || restoredLink.Position != link.Position || restoredLink.Version != link.Version || restoredLink.RequestID != link.RequestID {
		t.Fatal("restored homepage link differs")
	}
	var restoredPost models.Post
	if err := targetDB.First(&restoredPost, post.ID).Error; err != nil {
		t.Fatal("load restored article")
	}
	if restoredPost.Content != post.Content || restoredPost.SearchText != post.SearchText {
		t.Fatal("restored search text or content differs")
	}
	if restoredPost.Version != post.Version {
		t.Fatal("restored article version differs")
	}
	if err := targetDB.Exec("UPDATE posts SET summary = ? WHERE id = ?", "Restored update", post.ID).Error; err != nil {
		t.Fatal(err)
	}
	var nextVersion int64
	if err := targetDB.Model(&models.Post{}).Where("id = ?", post.ID).Pluck("version", &nextVersion).Error; err != nil || nextVersion != post.Version+1 {
		t.Fatalf("restored version trigger failed: version=%d error=%v", nextVersion, err)
	}
	for _, name := range []string{"idx_posts_search_text", "idx_posts_admin_order"} {
		if !targetDB.Migrator().HasIndex("posts", name) {
			t.Fatalf("restored index missing: %s", name)
		}
	}
	if !targetDB.Migrator().HasIndex("files", "idx_files_public_order") {
		t.Fatal("restored file ordering index missing")
	}
	var matches int64
	if err := targetDB.Model(&models.Post{}).Where("search_text ILIKE ?", "%restoredneedle%").Count(&matches).Error; err != nil || matches != 1 {
		t.Fatal("restored article search failed")
	}
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
