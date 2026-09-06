package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/httpcache"
	"blog-backend/internal/models"
	"blog-backend/internal/searchtext"
	"blog-backend/internal/testutil"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

func TestPostCollectionsReturnSummaries(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	admin := createTestUser(t, db, "summary-admin", "correct-password-123", "admin")
	auth := cookieAuth(signedToken(t, admin, testutil.TestJWTSecret, time.Now().Add(time.Hour), jwt.SigningMethodHS256))
	category := models.Category{Name: "Article category"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	body := strings.Repeat("Long正文 paragraph. ", 4096) + "bodyonlyneedle\n![hiddenlabel](https://example.invalid/hiddentarget)"
	posts := []models.Post{
		{Title: "Published article", Slug: "summary-published", Summary: "Introduction", Content: body, CategoryID: &category.ID, Status: "published", PublishedAt: &now},
		{Title: "Draft article", Slug: "summary-draft", Content: body, Status: "draft"},
	}
	for i := range posts {
		posts[i].SearchText = searchtext.Extract(posts[i].Content)
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatal(err)
	}
	router := SetupRouter()

	var projections []string
	callbackName := "test:record_post_projection"
	if err := db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "posts" {
			projections = append(projections, tx.Statement.SQL.String())
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Query().Remove(callbackName)

	for _, test := range []struct {
		path, key string
		auth      *requestAuth
		count     int
		cache     string
	}{
		{"/api/posts", "data", nil, 1, httpcache.PublicReadPolicy},
		{fmt.Sprintf("/api/posts?category_id=%d", category.ID), "data", nil, 1, httpcache.PublicReadPolicy},
		{"/api/admin/posts?sort=admin", "data", auth, 2, httpcache.NoStorePolicy},
	} {
		response := performJSONRequest(t, router, http.MethodGet, test.path, nil, test.auth, false)
		if response.Code != http.StatusOK {
			t.Fatalf("collection status = %d", response.Code)
		}
		var result map[string]json.RawMessage
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		requireSummaryItems(t, result[test.key], test.count)
		if response.Header().Get("Cache-Control") != test.cache {
			t.Fatal("collection cache boundary changed")
		}
	}
	if len(projections) < 6 {
		t.Fatal("did not capture list/count SQL")
	}
	for _, sql := range projections {
		projection, _, _ := strings.Cut(strings.ToLower(sql), " from ")
		if strings.Contains(projection, "content") || strings.Contains(projection, "select *") || strings.Contains(projection, "posts.*") {
			t.Fatal("list selected the article body")
		}
	}

	for _, test := range []struct {
		path  string
		auth  *requestAuth
		count int
	}{
		{"/api/search?q=bodyonlyneedle&scope=posts", nil, 1},
		{"/api/admin/search?q=bodyonlyneedle&scope=posts", auth, 2},
		{"/api/search?q=hiddenlabel&scope=posts", nil, 0},
		{"/api/search?q=hiddentarget&scope=posts", nil, 0},
		{"/api/search?q=unmatchedword&scope=posts", nil, 0},
	} {
		response := performJSONRequest(t, router, http.MethodGet, test.path, nil, test.auth, false)
		if response.Code != http.StatusOK {
			t.Fatalf("search status = %d", response.Code)
		}
		var result struct{ Posts json.RawMessage }
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		requireSummaryItems(t, result.Posts, test.count)
		if strings.Contains(response.Body.String(), "Long正文") {
			t.Fatal("body marker leaked into search response")
		}
	}
	empty := performJSONRequest(t, router, http.MethodGet, "/api/posts?page=100", nil, nil, false)
	var page struct{ Data json.RawMessage }
	if err := json.Unmarshal(empty.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	requireSummaryItems(t, page.Data, 0)

	detail := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/posts/%d", posts[0].ID), nil, nil, false)
	projection, _, _ := strings.Cut(strings.ToLower(projections[len(projections)-1]), " from ")
	if !strings.Contains(projection, "content") || strings.Contains(projection, "search_text") || strings.Contains(projection, "select *") {
		t.Fatal("article detail must select its original body without derived search text")
	}
	var full models.PostDetail
	if err := json.Unmarshal(detail.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	if detail.Code != 200 || full.Content != body || full.Category == nil || full.Category.ID != category.ID {
		t.Fatal("public detail lost body or category")
	}
}

func requireSummaryItems(t *testing.T, raw json.RawMessage, count int) {
	t.Helper()
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatal(err)
	}
	if items == nil || len(items) != count {
		t.Fatalf("summary array length = %d, want %d and a non-null array", len(items), count)
	}
	for _, item := range items {
		if _, exists := item["content"]; exists {
			t.Fatal("summary contains a content key")
		}
		if _, exists := item["analysis_search_text"]; exists {
			t.Fatal("summary contains derived text")
		}
		for _, key := range []string{"id", "title", "slug", "summary", "category_id", "category", "status", "published_at", "last_edited_at", "created_at", "updated_at"} {
			if _, exists := item[key]; !exists {
				t.Fatalf("summary is missing %s", key)
			}
		}
	}
}

func TestAdministratorPostDetailAccess(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	admin := createTestUser(t, db, "detail-admin", "correct-password-123", "admin")
	writer := createTestUser(t, db, "detail-writer", "correct-password-123", "writer")
	adminAuth := cookieAuth(signedToken(t, admin, testutil.TestJWTSecret, time.Now().Add(time.Hour), jwt.SigningMethodHS256))
	writerAuth := cookieAuth(signedToken(t, writer, testutil.TestJWTSecret, time.Now().Add(time.Hour), jwt.SigningMethodHS256))
	now := time.Now().UTC()
	posts := []models.Post{
		{Title: "Draft detail", Slug: "draft-detail", Content: "Private draft body", Status: "draft"},
		{Title: "Published detail", Slug: "published-detail", Content: "Public detail body", Status: "published", PublishedAt: &now},
	}
	for i := range posts {
		posts[i].SearchText = searchtext.Extract(posts[i].Content)
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatal(err)
	}
	router := SetupRouter()
	for _, post := range posts {
		path := fmt.Sprintf("/api/admin/posts/%d", post.ID)
		for _, test := range []struct {
			auth   *requestAuth
			status int
			code   string
		}{
			{nil, 401, "invalid_session"}, {writerAuth, 403, "admin_required"},
		} {
			result := performJSONRequest(t, router, http.MethodGet, path, nil, test.auth, false)
			requireAPIError(t, result.Code, result.Body.Bytes(), test.status, test.code)
			if result.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
				t.Fatal("denied detail was cacheable")
			}
		}
		result := performJSONRequest(t, router, http.MethodGet, path, nil, adminAuth, false)
		var detail models.PostDetail
		if err := json.Unmarshal(result.Body.Bytes(), &detail); err != nil {
			t.Fatal(err)
		}
		if result.Code != 200 || detail.ID != post.ID || detail.Content != post.Content || detail.Status != post.Status {
			t.Fatal("administrator did not receive the full requested article")
		}
		if result.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
			t.Fatal("administrator detail was cacheable")
		}
	}
	for _, test := range []struct {
		path   string
		auth   *requestAuth
		status int
		code   string
	}{
		{fmt.Sprintf("/api/posts/%d", posts[0].ID), adminAuth, 404, "post_not_found"},
		{"/api/admin/posts/99999999", adminAuth, 404, "post_not_found"},
		{"/api/admin/posts/invalid", adminAuth, 400, "invalid_id"},
	} {
		result := performJSONRequest(t, router, http.MethodGet, test.path, nil, test.auth, false)
		requireAPIError(t, result.Code, result.Body.Bytes(), test.status, test.code)
	}
}
