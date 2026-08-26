package routes

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/health"
	"blog-backend/internal/models"
	"blog-backend/internal/observability"
	"blog-backend/internal/security"
	"blog-backend/internal/testutil"
	"github.com/gin-gonic/gin"
)

func BenchmarkAnonymousPublicReads(b *testing.B) {
	if os.Getenv("TEST_DB_DSN") == "" {
		b.Skip("TEST_DB_DSN is not configured; skipping PostgreSQL benchmark")
	}
	b.Setenv("UPLOAD_DIR", b.TempDir())
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(previousLogger) })
	db, err := testutil.OpenDatabase()
	if err != nil {
		b.Fatalf("open benchmark database: %v", err)
	}
	if err := testutil.ResetDatabase(db); err != nil {
		b.Fatalf("reset benchmark database: %v", err)
	}
	b.Cleanup(func() {
		if err := testutil.ResetDatabase(db); err != nil {
			b.Errorf("clean benchmark database: %v", err)
		}
	})

	categories := make([]models.Category, 10)
	for index := range categories {
		categories[index] = models.Category{Name: fmt.Sprintf("Benchmark category %02d", index+1)}
	}
	if err := db.Create(&categories).Error; err != nil {
		b.Fatalf("seed benchmark categories: %v", err)
	}
	publishedAt := time.Date(2026, time.August, 26, 0, 0, 0, 0, time.UTC)
	posts := make([]models.Post, 200)
	for index := range posts {
		categoryID := categories[index%len(categories)].ID
		posts[index] = models.Post{
			Title:       fmt.Sprintf("Anonymous benchmark article %03d", index+1),
			Slug:        fmt.Sprintf("anonymous-benchmark-article-%03d", index+1),
			Summary:     "A representative public article used for repeatable read measurements.",
			Content:     "# Public benchmark\n\nThis article represents an anonymous visitor reading and searching published content.",
			CategoryID:  &categoryID,
			Status:      "published",
			PublishedAt: &publishedAt,
		}
	}
	if err := db.Create(&posts).Error; err != nil {
		b.Fatalf("seed benchmark posts: %v", err)
	}
	files := make([]models.File, 100)
	for index := range files {
		files[index] = models.File{
			Name:        fmt.Sprintf("benchmark-%03d.txt", index+1),
			OrigName:    fmt.Sprintf("benchmark-%03d.txt", index+1),
			DisplayName: fmt.Sprintf("Benchmark file %03d", index+1),
			Path:        fmt.Sprintf("benchmark-%03d.txt", index+1),
			Size:        128,
			MimeType:    "text/plain",
		}
	}
	if err := db.Create(&files).Error; err != nil {
		b.Fatalf("seed benchmark files: %v", err)
	}
	if err := db.Create([]models.Setting{
		{Key: "profile_name", Value: "Benchmark author"},
		{Key: "site_description", Value: "Anonymous read benchmark"},
	}).Error; err != nil {
		b.Fatalf("seed benchmark settings: %v", err)
	}

	gin.SetMode(gin.TestMode)
	cfg := config.Current()
	router := setupRouter(
		health.NewChecker(config.DB, cfg.UploadDir, cfg.HealthCheckTimeout),
		observability.NewMetrics(),
		security.NewPublicSearchLimiter(1_000_000_000, 1_000_000_000),
	)
	benchmarks := []struct {
		name string
		path string
	}{
		{name: "post-list", path: "/api/posts?page=1&limit=10"},
		{name: "post-detail", path: fmt.Sprintf("/api/posts/%d", posts[0].ID)},
		{name: "categories", path: "/api/categories"},
		{name: "file-list", path: "/api/files?page=1&limit=10"},
		{name: "settings", path: "/api/settings"},
		{name: "search", path: "/api/search?q=anonymous&scope=posts"},
	}

	for _, benchmark := range benchmarks {
		b.Run(benchmark.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				request := httptest.NewRequest(http.MethodGet, benchmark.path, nil)
				request.RemoteAddr = "192.0.2.100:1234"
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				if response.Code != http.StatusOK {
					b.Fatalf("%s status = %d; body=%s", benchmark.path, response.Code, response.Body.String())
				}
				if len(request.Cookies()) != 0 {
					b.Fatal("anonymous benchmark request unexpectedly contained cookies")
				}
			}
		})
	}
}
