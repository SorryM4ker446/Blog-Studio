package routes

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/health"
	"blog-backend/internal/httpcache"
	"blog-backend/internal/models"
	"blog-backend/internal/observability"
	"blog-backend/internal/security"
	"github.com/gin-gonic/gin"
)

func TestPublicAndAuthenticatedCacheBoundaries(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "cache-admin", "correct-password-123", "admin")
	publishedAt := time.Now().UTC()
	post := models.Post{
		Title: "Cached public post", Slug: "cached-public-post", Content: "public",
		Status: "published", PublishedAt: &publishedAt,
	}
	if err := db.Create(&post).Error; err != nil {
		t.Fatalf("create public post: %v", err)
	}

	router := SetupRouter()
	for _, path := range []string{
		"/api/posts",
		fmt.Sprintf("/api/posts/%d", post.ID),
		"/api/categories",
		"/api/files",
		"/api/settings",
		"/api/search?q=cached&scope=posts",
	} {
		response := performJSONRequest(t, router, http.MethodGet, path, nil, nil, false)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d; body=%s", path, response.Code, response.Body.String())
		}
		if cacheControl := response.Header().Get("Cache-Control"); cacheControl != httpcache.PublicReadPolicy {
			t.Fatalf("%s Cache-Control = %q, want %q", path, cacheControl, httpcache.PublicReadPolicy)
		}
	}

	invalid := performJSONRequest(t, router, http.MethodGet, "/api/posts?page=invalid", nil, nil, false)
	if invalid.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
		t.Fatalf("public error Cache-Control = %q", invalid.Header().Get("Cache-Control"))
	}

	auth := loginAs(t, router, "cache-admin", "correct-password-123")
	admin := performJSONRequest(t, router, http.MethodGet, "/api/admin/posts", nil, auth, false)
	if admin.Code != http.StatusOK || admin.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
		t.Fatalf("admin response status=%d Cache-Control=%q", admin.Code, admin.Header().Get("Cache-Control"))
	}

	withoutOrigin := performJSONRequest(t, router, http.MethodGet, "/api/settings", nil, nil, false)
	if !headerContainsToken(withoutOrigin.Header().Values("Vary"), "Origin") {
		t.Fatalf("public response Vary = %v, want Origin", withoutOrigin.Header().Values("Vary"))
	}
}

func TestPublicSearchRateLimitAndMetrics(t *testing.T) {
	requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	cfg := config.Current()
	metrics := observability.NewMetrics()
	router := setupRouter(
		health.NewChecker(config.DB, cfg.UploadDir, cfg.HealthCheckTimeout),
		metrics,
		security.NewPublicSearchLimiter(60, 1),
	)
	client := &requestAuth{remoteIP: "198.51.100.44"}

	first := performJSONRequest(t, router, http.MethodGet, "/api/search?q=absent&scope=posts", nil, client, false)
	if first.Code != http.StatusOK {
		t.Fatalf("first search status = %d; body=%s", first.Code, first.Body.String())
	}
	limited := performJSONRequest(t, router, http.MethodGet, "/api/search?q=absent&scope=posts", nil, client, false)
	requireAPIError(t, limited.Code, limited.Body.Bytes(), http.StatusTooManyRequests, "search_rate_limited")
	if limited.Header().Get("Retry-After") != "1" || limited.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
		t.Fatalf("limited headers = %v", limited.Header())
	}

	secretQuery := "must-not-appear-in-metrics"
	unmatched := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/missing?token=%s", secretQuery), nil, nil, false)
	if unmatched.Code != http.StatusNotFound {
		t.Fatalf("unmatched status = %d", unmatched.Code)
	}
	scrape := performJSONRequest(t, router, http.MethodGet, "/internal/metrics", nil, nil, false)
	if scrape.Code != http.StatusOK || scrape.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
		t.Fatalf("metrics status=%d Cache-Control=%q", scrape.Code, scrape.Header().Get("Cache-Control"))
	}
	body := scrape.Body.String()
	for _, expected := range []string{
		"blog_studio_http_requests_total",
		`route="/api/search"`,
		`route="unmatched"`,
		"blog_studio_public_search_rate_limit_rejections_total 1",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("metrics body is missing %q", expected)
		}
	}
	if strings.Contains(body, secretQuery) {
		t.Fatal("metrics exposed a request query value")
	}
}

func headerContainsToken(values []string, token string) bool {
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}
