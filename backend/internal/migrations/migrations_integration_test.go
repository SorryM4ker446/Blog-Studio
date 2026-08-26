package migrations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"blog-backend/internal/models"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestApplyCreatesCurrentSchemaOnEmptyDatabase(t *testing.T) {
	db := openIsolatedSchema(t)

	if err := VerifyCurrent(context.Background(), db); !errors.Is(err, ErrDatabaseNotCurrent) {
		t.Fatalf("VerifyCurrent() error = %v, want ErrDatabaseNotCurrent", err)
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatalf("Apply() error = %v", err)
	}
	if err := VerifyCurrent(context.Background(), db); err != nil {
		t.Fatalf("VerifyCurrent() after Apply error = %v", err)
	}
	for _, table := range []any{&models.User{}, &models.Category{}, &models.Post{}, &models.File{}, &models.Setting{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("application table for %T was not created", table)
		}
	}
}

func TestApplyBaselinesExistingSchemaWithoutChangingData(t *testing.T) {
	db := openIsolatedSchema(t)
	if err := db.AutoMigrate(
		&models.User{},
		&models.Category{},
		&models.Post{},
		&models.File{},
		&models.Setting{},
	); err != nil {
		t.Fatalf("create existing schema: %v", err)
	}
	setting := models.Setting{Key: "site_title", Value: "Existing site"}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatalf("create existing setting: %v", err)
	}

	if err := Apply(context.Background(), db); err != nil {
		t.Fatalf("first Apply() error = %v", err)
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatalf("second Apply() error = %v", err)
	}
	var historyCount int64
	if err := db.Table(migrationTable).Count(&historyCount).Error; err != nil {
		t.Fatalf("count migration history: %v", err)
	}
	if historyCount != int64(len(registered)) {
		t.Fatalf("migration history count = %d, want %d", historyCount, len(registered))
	}
	var restored models.Setting
	if err := db.First(&restored, setting.ID).Error; err != nil {
		t.Fatalf("load preserved setting: %v", err)
	}
	if restored.Value != setting.Value {
		t.Fatalf("preserved setting value = %q, want %q", restored.Value, setting.Value)
	}
}

func TestApplyNormalizesLegacyRowsAndRestoresConstraints(t *testing.T) {
	db := openIsolatedSchema(t)
	if err := db.AutoMigrate(
		&models.User{},
		&models.Category{},
		&models.Post{},
		&models.File{},
		&models.Setting{},
	); err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}
	legacyDDL := []string{
		`ALTER TABLE users ALTER COLUMN role DROP NOT NULL`,
		`ALTER TABLE files ALTER COLUMN size DROP NOT NULL`,
		`ALTER TABLE files ALTER COLUMN is_system DROP NOT NULL`,
		`ALTER TABLE posts DROP CONSTRAINT IF EXISTS fk_posts_category`,
		`ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_status`,
		`ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_publication_timestamp`,
		`ALTER TABLE files DROP CONSTRAINT IF EXISTS chk_files_display_name_not_blank`,
	}
	for _, statement := range legacyDDL {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("prepare legacy schema with %q: %v", statement, err)
		}
	}
	legacyRows := []string{
		`INSERT INTO users (username, password_hash, role, session_version, created_at)
		 VALUES ('legacy-writer', 'hash', NULL, 1, NOW())`,
		`INSERT INTO posts (title, slug, content, category_id, status, created_at, updated_at)
		 VALUES ('Legacy published', 'legacy-published', 'content', 0, 'published', NOW(), NOW())`,
		`INSERT INTO posts (title, slug, content, status, created_at, updated_at)
		 VALUES ('Legacy invalid', 'legacy-invalid', 'content', 'archived', NOW(), NOW())`,
		`INSERT INTO files (name, orig_name, display_name, description, path, size, is_system, created_at)
		 VALUES ('legacy.txt', 'legacy.txt', '', '', 'legacy.txt', NULL, NULL, NOW())`,
	}
	for _, statement := range legacyRows {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("insert legacy row: %v", err)
		}
	}

	if err := Apply(context.Background(), db); err != nil {
		t.Fatalf("Apply() legacy upgrade error = %v", err)
	}
	var user models.User
	if err := db.Where("username = ?", "legacy-writer").First(&user).Error; err != nil {
		t.Fatalf("load normalized user: %v", err)
	}
	if user.Role != "writer" {
		t.Fatalf("legacy user role = %q, want writer", user.Role)
	}
	var posts []models.Post
	if err := db.Order("slug ASC").Find(&posts).Error; err != nil {
		t.Fatalf("load normalized posts: %v", err)
	}
	if len(posts) != 2 {
		t.Fatalf("normalized post count = %d, want 2", len(posts))
	}
	bySlug := map[string]models.Post{posts[0].Slug: posts[0], posts[1].Slug: posts[1]}
	if post := bySlug["legacy-published"]; post.CategoryID != nil || post.Status != "published" || post.PublishedAt == nil {
		t.Fatalf("normalized published post = %+v", post)
	}
	if post := bySlug["legacy-invalid"]; post.Status != "draft" || post.PublishedAt != nil {
		t.Fatalf("normalized invalid-status post = %+v", post)
	}
	var file models.File
	if err := db.Where("name = ?", "legacy.txt").First(&file).Error; err != nil {
		t.Fatalf("load normalized file: %v", err)
	}
	if file.Size != 0 || file.IsSystem || file.DisplayName != "legacy.txt" {
		t.Fatalf("normalized file = %+v", file)
	}
	for _, name := range []string{"fk_posts_category", "chk_posts_status", "chk_posts_publication_timestamp"} {
		if !db.Migrator().HasConstraint("posts", name) {
			t.Fatalf("constraint %s was not restored", name)
		}
	}
}

func TestConcurrentApplyRunsEachVersionOnce(t *testing.T) {
	db := openIsolatedSchema(t)
	const workers = 4
	errorsByWorker := make(chan error, workers)
	var group sync.WaitGroup
	for index := 0; index < workers; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			errorsByWorker <- Apply(context.Background(), db)
		}()
	}
	group.Wait()
	close(errorsByWorker)
	for err := range errorsByWorker {
		if err != nil {
			t.Fatalf("concurrent Apply() error = %v", err)
		}
	}
	var historyCount int64
	if err := db.Table(migrationTable).Count(&historyCount).Error; err != nil {
		t.Fatalf("count migration history: %v", err)
	}
	if historyCount != int64(len(registered)) {
		t.Fatalf("migration history count = %d, want %d", historyCount, len(registered))
	}
}

func openIsolatedSchema(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_DB_DSN"))
	if dsn == "" {
		t.Skip("TEST_DB_DSN is not configured; skipping PostgreSQL migration integration test")
	}
	parsed, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DB_DSN: %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(parsed.Database), "_test") {
		t.Fatalf("refusing to use non-test database %q", parsed.Database)
	}

	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		t.Fatalf("generate isolated schema name: %v", err)
	}
	schema := "migration_" + hex.EncodeToString(randomBytes)
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	if err := admin.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatalf("create isolated schema: %v", err)
	}

	isolatedDSN, err := withSearchPath(dsn, schema)
	if err != nil {
		t.Fatalf("build isolated schema connection: %v", err)
	}
	db, err := gorm.Open(postgres.Open(isolatedDSN), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("connect to isolated schema: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, sqlErr := db.DB(); sqlErr == nil {
			_ = sqlDB.Close()
		}
		if dropErr := admin.Exec(fmt.Sprintf(`DROP SCHEMA IF EXISTS "%s" CASCADE`, schema)).Error; dropErr != nil {
			t.Errorf("drop isolated schema: %v", dropErr)
		}
		if sqlDB, sqlErr := admin.DB(); sqlErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func withSearchPath(dsn, schema string) (string, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String(), nil
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema, nil
}
