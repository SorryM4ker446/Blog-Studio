package migrations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/models"
	"blog-backend/internal/searchtext"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func loadApplicationSchemaFixture(t *testing.T, db *gorm.DB) {
	t.Helper()
	fixture, err := os.ReadFile("testdata/application_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(fixture)).Error; err != nil {
		t.Fatal("load fixed historical schema")
	}
}

func TestSearchMigrationBackfillsHistoricalArticlesWithoutChangingTimestamps(t *testing.T) {
	db := openIsolatedSchema(t)
	loadApplicationSchemaFixture(t, db)
	if err := VerifyCurrent(context.Background(), db); !errors.Is(err, ErrDatabaseNotCurrent) {
		t.Fatal("old schema must be rejected by startup")
	}
	stamp := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	body := "# Visible\n\n[中文 label](private-target) ![hidden](image.png)\n\n`code`"
	for i := 0; i < 130; i++ {
		if err := db.Exec(`INSERT INTO posts(title,slug,content,status,published_at,last_edited_at,created_at,updated_at) VALUES ('Article', ?, ?, 'published', ?, ?, ?, ?)`, strings.Repeat("a", i+1), body, stamp, stamp, stamp, stamp).Error; err != nil {
			t.Fatal(err)
		}
	}
	// An index-name collision fails after the backfill; every schema/data/history change must roll back.
	if err := db.Exec(`CREATE INDEX idx_posts_admin_order ON posts(id)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := Apply(context.Background(), db); err == nil {
		t.Fatal("expected transactional index failure")
	}
	if db.Migrator().HasColumn("posts", "search_text") {
		t.Fatal("failed migration retained search column")
	}
	var count int64
	db.Table(migrationTable).Count(&count)
	if count != 1 {
		t.Fatal("failed migration advanced history")
	}
	if err := db.Exec(`DROP INDEX idx_posts_admin_order`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := Apply(context.Background(), db); err != nil {
			t.Fatal(err)
		}
	}
	var posts []models.Post
	if err := db.Order("id").Find(&posts).Error; err != nil {
		t.Fatal(err)
	}
	if len(posts) != 130 {
		t.Fatal("backfill lost articles")
	}
	for _, p := range posts {
		if p.Content != body || p.SearchText != searchtext.Extract(body) || !p.CreatedAt.Equal(stamp) || !p.UpdatedAt.Equal(stamp) || p.PublishedAt == nil || !p.PublishedAt.Equal(stamp) || p.LastEditedAt == nil || !p.LastEditedAt.Equal(stamp) {
			t.Fatal("backfill changed source article or timeline")
		}
	}
	for _, name := range []string{"idx_posts_search_text", "idx_posts_admin_order", "idx_files_public_order"} {
		if !db.Migrator().HasIndex(map[string]string{"idx_posts_search_text": "posts", "idx_posts_admin_order": "posts", "idx_files_public_order": "files"}[name], name) {
			t.Fatalf("missing index %s", name)
		}
	}
	if err := db.Exec(`UPDATE posts SET search_text=NULL WHERE id=1`).Error; err == nil {
		t.Fatal("search text must remain non-null")
	}
	if err := VerifyCurrent(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var options string
	if err := db.Raw(`SELECT array_to_string(reloptions, ',') FROM pg_class WHERE oid='idx_posts_search_text'::regclass`).Scan(&options).Error; err != nil || options != "fastupdate=off" {
		t.Fatal("search index maintenance setting changed")
	}
}

func TestSearchMigrationRequiresOperatorExtensionPreparation(t *testing.T) {
	db := openExtensionTestDatabase(t)
	loadApplicationSchemaFixture(t, db)
	if err := Apply(context.Background(), db); err == nil || !strings.Contains(err.Error(), "pg_trgm must be installed by an operator") {
		t.Fatalf("unexpected missing-extension error: %v", err)
	}
	if db.Migrator().HasColumn("posts", "search_text") {
		t.Fatal("missing prerequisite changed schema")
	}
	if err := db.Exec(`CREATE EXTENSION pg_trgm WITH SCHEMA public`).Error; err != nil {
		t.Fatal("prepare isolated extension")
	}
	if err := db.Exec(`CREATE SCHEMA extension_location; ALTER EXTENSION pg_trgm SET SCHEMA extension_location`).Error; err != nil {
		t.Fatal("move isolated extension")
	}
	if err := Apply(context.Background(), db); err == nil || !strings.Contains(err.Error(), "schema public") {
		t.Fatal("extension in wrong schema must be rejected")
	}
	if err := db.Exec(`ALTER EXTENSION pg_trgm SET SCHEMA public`).Error; err != nil {
		t.Fatal("restore isolated extension location")
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
}

func TestSearchMigrationRequiresPublicSchemaUsage(t *testing.T) {
	db := openExtensionTestDatabase(t)
	if err := db.Exec(`CREATE EXTENSION pg_trgm WITH SCHEMA public; CREATE SCHEMA application`).Error; err != nil {
		t.Fatal("prepare isolated privilege fixture")
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		t.Fatal(err)
	}
	role := pgx.Identifier{"search_migration_" + hex.EncodeToString(random)}.Sanitize()
	rollback := errors.New("rollback isolated privilege fixture")
	var rejected bool
	err := db.Transaction(func(tx *gorm.DB) error {
		for _, sql := range []string{"CREATE ROLE " + role + " NOLOGIN", "GRANT USAGE, CREATE ON SCHEMA application TO " + role, "REVOKE USAGE ON SCHEMA public FROM PUBLIC", "SET LOCAL search_path=application", "SET LOCAL ROLE " + role} {
			if err := tx.Exec(sql).Error; err != nil {
				return errors.New("prepare temporary migration role")
			}
		}
		migrationError := Apply(context.Background(), tx)
		rejected = migrationError != nil && strings.Contains(migrationError.Error(), "USAGE granted to the migration role")
		return rollback
	})
	if !errors.Is(err, rollback) || !rejected {
		t.Fatal("missing public schema USAGE did not fail with the prerequisite error")
	}
	if db.Migrator().HasTable("application.blog_schema_migrations") {
		t.Fatal("failed privilege fixture retained migration history")
	}
}

func openExtensionTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_DB_DSN"))
	if dsn == "" {
		t.Skip("TEST_DB_DSN is not configured")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid TEST_DB_DSN")
	}
	if !strings.HasSuffix(strings.ToLower(cfg.Database), "_test") {
		t.Fatal("extension integration requires an isolated _test database")
	}
	open := func(c *pgx.ConnConfig) *gorm.DB {
		t.Helper()
		conn := stdlib.OpenDB(*c)
		db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			conn.Close()
			t.Fatal("connect to isolated extension test database")
		}
		return db
	}
	admin := open(cfg)
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		t.Fatal(err)
	}
	name := "blog_extension_" + hex.EncodeToString(random) + "_test"
	identifier := pgx.Identifier{name}.Sanitize()
	if err := admin.Exec("CREATE DATABASE " + identifier + " TEMPLATE template0").Error; err != nil {
		t.Fatal("create isolated extension test database")
	}
	isolated := cfg.Copy()
	isolated.Database = name
	isolated.RuntimeParams = map[string]string{}
	db := open(isolated)
	t.Cleanup(func() {
		if conn, err := db.DB(); err == nil {
			conn.Close()
		}
		if err := admin.Exec("DROP DATABASE " + identifier + " WITH (FORCE)").Error; err != nil {
			t.Error("drop isolated extension test database")
		}
		if conn, err := admin.DB(); err == nil {
			conn.Close()
		}
	})
	return db
}
