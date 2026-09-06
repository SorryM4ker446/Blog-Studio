package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	randv2 "math/rand/v2"
	"os"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/migrations"
	"blog-backend/internal/models"
	"blog-backend/internal/searchtext"
	"blog-backend/internal/testutil"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func validateReadAnalysisDSN(dsn string) error {
	if strings.TrimSpace(dsn) == "" {
		return fmt.Errorf("TEST_DB_DSN is required")
	}
	parsed, err := pgx.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("TEST_DB_DSN is invalid")
	}
	if !strings.HasSuffix(strings.ToLower(parsed.Database), "_test") {
		return fmt.Errorf("query analysis requires a database name ending in _test")
	}
	return nil
}

// All fixture data, experimental columns, indexes and extensions are rolled back.
// Never reuse OpenDatabase: its migration targets the normal test schema.
func openReadAnalysisDatabase(t testing.TB) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DB_DSN")
	if err := validateReadAnalysisDSN(dsn); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]string{
		"DB_DSN": dsn, "APP_ENV": "test", "JWT_SECRET": testutil.TestJWTSecret,
		"COOKIE_SECURE": "false", "ALLOWED_ORIGINS": "http://127.0.0.1:3100",
		"UPLOAD_DIR": t.TempDir(),
	} {
		t.Setenv(key, value)
	}
	if _, err := config.LoadFromEnv(); err != nil {
		t.Fatal("could not load the query analysis test configuration")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Silent),
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		t.Fatal("could not connect to the query analysis test database")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal("could not access the query analysis connection")
	}
	sqlDB.SetMaxOpenConns(1)
	tx := db.Begin()
	if tx.Error != nil {
		_ = sqlDB.Close()
		t.Fatal("could not begin the query analysis transaction")
	}
	previousDB := config.DB
	t.Cleanup(func() {
		config.DB = previousDB
		if err := tx.Rollback().Error; err != nil {
			t.Error("could not roll back the query analysis transaction")
		}
		if err := sqlDB.Close(); err != nil {
			t.Error("could not close the query analysis connection")
		}
	})
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		t.Fatal("could not generate an isolated schema identifier")
	}
	schema := pgx.Identifier{"read_analysis_" + hex.EncodeToString(randomBytes)}.Sanitize()
	analysisExec(t, tx, "CREATE SCHEMA "+schema)
	analysisExec(t, tx, "SET LOCAL search_path = "+schema)
	analysisExec(t, tx, "SET LOCAL statement_timeout = '120s'")
	analysisExec(t, tx, "SET LOCAL lock_timeout = '10s'")
	analysisExec(t, tx, "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public")
	if err := migrations.Apply(context.Background(), tx); err != nil {
		t.Fatal("could not apply the existing migrations in the isolated schema")
	}
	analysisExec(t, tx, "SET LOCAL search_path = "+schema+", public")
	config.DB = tx
	return tx
}

func analysisExec(t testing.TB, db *gorm.DB, sql string, args ...any) {
	t.Helper()
	if err := db.Exec(sql, args...).Error; err != nil {
		t.Fatalf("query analysis SQL failed: %s", sql)
	}
}

type readAnalysisFixture struct {
	Posts       int
	Files       int
	Categories  int
	BodyBytes   int
	SearchTexts []string
}

func seedReadAnalysis(t testing.TB, db *gorm.DB, count int) readAnalysisFixture {
	t.Helper()
	fixture := readAnalysisFixture{Posts: count, Files: count / 2, Categories: 40}
	categories := make([]models.Category, fixture.Categories)
	for i := range categories {
		categories[i].Name = fmt.Sprintf("Topic %02d", i+1)
	}
	categories[1].Name = "数据库与检索"
	if err := db.Create(&categories).Error; err != nil {
		t.Fatal("could not seed query analysis categories")
	}
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	fixture.SearchTexts = make([]string, count)
	for start := 0; start < count; start += 32 {
		posts := make([]models.Post, 0, 32)
		for i := start; i < min(start+32, count); i++ {
			visible, markdown := analysisBody(i)
			category := &categories[0].ID
			if i%10 == 6 {
				category = nil
			} else if i%10 >= 7 {
				category = &categories[1+(i/10)%39].ID
			}
			published := base.Add(time.Duration(i/3) * time.Hour)
			updated := published.Add(time.Duration(i%11) * time.Hour)
			post := models.Post{
				Title: fmt.Sprintf("Article %04d", i+1), Slug: fmt.Sprintf("analysis-article-%04d", i+1),
				Summary: "Deterministic public reading and database query fixture.",
				Content: markdown, CategoryID: category, Status: "published",
				PublishedAt: &published, CreatedAt: published, UpdatedAt: updated,
			}
			if i%5 == 0 {
				post.Status, post.PublishedAt = "draft", nil
			} else if i%3 == 0 {
				post.LastEditedAt = &updated
			}
			posts = append(posts, post)
			fixture.BodyBytes += len(markdown)
			fixture.SearchTexts[i] = visible
		}
		for i := range posts {
			posts[i].SearchText = searchtext.Extract(posts[i].Content)
		}
		if err := db.Create(&posts).Error; err != nil {
			t.Fatal("could not seed query analysis posts")
		}
	}
	files := make([]models.File, fixture.Files)
	for i := range files {
		name := fmt.Sprintf("resource-%04d.txt", i+1)
		label := fmt.Sprintf("Resource %04d", i+1)
		if i%113 == 0 {
			label += " needlequartz"
		}
		description := "File metadata fixture"
		if i%17 == 0 {
			description += " descriptionneedle"
		}
		files[i] = models.File{
			Name: name, OrigName: name, DisplayName: label, Description: description,
			Path: name, MimeType: "text/plain", Size: 128, IsSystem: i%10 == 0,
			CreatedAt: base.Add(time.Duration(i/3) * time.Hour),
		}
	}
	if err := db.CreateInBatches(files, 100).Error; err != nil {
		t.Fatal("could not seed query analysis files")
	}
	if err := db.Create(&models.Setting{Key: "profile_name", Value: "Read analysis author"}).Error; err != nil {
		t.Fatal("could not seed query analysis settings")
	}
	for _, table := range []string{"posts", "categories", "files"} {
		analysisExec(t, db, "ANALYZE "+table)
	}
	return fixture
}

// Visible text is fixture input, not a second production Markdown parser.
func analysisBody(index int) (string, string) {
	words := strings.Fields("database article request response category storage reader version content transaction relation query buffer memory network editor window history recovery publication record stable ordered service resource metadata browser access session contract constraint statement measure latency throughput row index search token public private draft title summary document sample fixture tree page limit count client server filter restore update create delete render")
	random := randv2.New(randv2.NewPCG(uint64(index+1), 20260906))
	var body strings.Builder
	target := []int{8 << 10, 32 << 10, 128 << 10}[index%3]
	for body.Len() < target {
		for range 16 {
			body.WriteString(words[random.IntN(len(words))])
			body.WriteByte(' ')
		}
		body.WriteByte('\n')
	}
	body.WriteString("中文数据库检索案例。\n")
	if index%113 == 0 {
		body.WriteString("needlequartz 稀有匹配案例。\n")
	}
	visible := body.String() + "Visible reference\n"
	markdown := body.String() + "[Visible reference](https://example.invalid/hiddenneedle)\n![hiddenneedle](https://example.invalid/image.png)\n"
	return visible, markdown
}

func TestReadAnalysisRejectsUnsafeDatabase(t *testing.T) {
	for _, dsn := range []string{"", "postgres://invalid%zz", "host=localhost dbname=blog_db", "host=localhost dbname=blog_test_extra"} {
		if validateReadAnalysisDSN(dsn) == nil {
			t.Fatal("accepted a missing, invalid or non-test database")
		}
	}
	for _, dsn := range []string{"host=localhost dbname=analysis_test", "postgres://localhost/analysis_TEST"} {
		if err := validateReadAnalysisDSN(dsn); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReadAnalysisFixtureHasDistinctLongBodies(t *testing.T) {
	seen := make(map[string]bool)
	for i := range 6 {
		visible, markdown := analysisBody(i)
		if len(markdown) < []int{8 << 10, 32 << 10, 128 << 10}[i%3] || seen[markdown] {
			t.Fatal("fixture bodies must be distinct and exercise the specified lengths")
		}
		seen[markdown] = true
		if strings.Contains(visible, "hiddenneedle") || !strings.Contains(markdown, "hiddenneedle") {
			t.Fatal("fixture must distinguish visible text from hidden link/image metadata")
		}
	}
}

func TestReadAnalysisRollsBackSchema(t *testing.T) {
	if os.Getenv("TEST_DB_DSN") == "" {
		t.Skip("TEST_DB_DSN is required for the isolation integration test")
	}
	var schema string
	t.Run("isolated transaction", func(t *testing.T) {
		db := openReadAnalysisDatabase(t)
		if err := db.Raw("SELECT current_schema()").Scan(&schema).Error; err != nil || !strings.HasPrefix(schema, "read_analysis_") {
			t.Fatal("analysis did not select its isolated schema")
		}
		var count int64
		if err := db.Raw("SELECT count(*) FROM pg_tables WHERE schemaname=current_schema() AND tablename='posts'").Scan(&count).Error; err != nil || count != 1 {
			t.Fatal("migrations did not create an isolated posts table")
		}
	})
	if t.Failed() {
		return
	}
	db, err := gorm.Open(postgres.Open(os.Getenv("TEST_DB_DSN")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("could not verify rollback")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal("could not inspect rollback connection")
	}
	defer sqlDB.Close()
	var count int64
	if err := db.Raw("SELECT count(*) FROM pg_namespace WHERE nspname=?", schema).Scan(&count).Error; err != nil || count != 0 {
		t.Fatal("analysis left an isolated schema behind")
	}
}
