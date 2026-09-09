package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/httpcache"
	"blog-backend/internal/models"
	"blog-backend/internal/search"
	"blog-backend/internal/searchtext"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestSearchPaginationAndVisibility(t *testing.T) {
	t.Setenv("PUBLIC_SEARCH_BURST", "200")
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "search-admin", "correct-password", "admin")
	category := models.Category{Name: "Original category"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 9, 6, 10, 0, 0, 0, time.UTC)
	var posts []models.Post
	var files []models.File
	for i := 0; i < 13; i++ {
		status := "published"
		if i >= 11 {
			status = "draft"
		}
		post := models.Post{Title: fmt.Sprintf("needle %d", i), Slug: fmt.Sprintf("paged-%d", i), Content: "needle bodyonly 中 xy Äpfel Éclair 100% a_b C:\\temp\n![hiddenalt](hiddenimage.png)", Status: status, PublishedAt: &stamp, CreatedAt: stamp, UpdatedAt: stamp}
		if i%2 == 0 {
			post.CategoryID = &category.ID
		}
		post.SearchText = searchtext.Extract(post.Content)
		posts = append(posts, post)
		files = append(files, models.File{Name: fmt.Sprintf("stored-%d", i), OrigName: "private-original.txt", DisplayName: fmt.Sprintf("needle %d", i), Description: "descriptiononly", Path: fmt.Sprintf("stored-%d", i), IsSystem: i >= 11, CreatedAt: stamp})
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	router := SetupRouter()
	auth := loginAs(t, router, "search-admin", "correct-password")
	read := func(path string, admin bool) search.Result {
		t.Helper()
		var requestCredentials *requestAuth
		cache := httpcache.PublicReadPolicy
		if admin {
			requestCredentials = auth
			cache = httpcache.NoStorePolicy
		}
		response := performJSONRequest(t, router, http.MethodGet, path, nil, requestCredentials, false)
		if response.Code != 200 {
			t.Fatalf("search status %d for %s: %s", response.Code, path, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != cache {
			t.Fatal("search cache boundary changed")
		}
		var result search.Result
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Posts == nil || result.Files == nil {
			t.Fatal("empty result arrays must not be null")
		}
		if len(result.Posts)+len(result.Files) > result.Limit || result.Total != result.PostsTotal+result.FilesTotal {
			t.Fatal("invalid combined page or totals")
		}
		if strings.Contains(response.Body.String(), `"content"`) || strings.Contains(response.Body.String(), `"search_text"`) || strings.Contains(response.Body.String(), `"path"`) {
			t.Fatal("private projection leaked")
		}
		return result
	}
	for _, test := range []struct {
		endpoint string
		admin    bool
		total    int64
	}{
		{"/api/search", false, 22}, {"/api/admin/search", true, 26},
	} {
		t.Run(test.endpoint, func(t *testing.T) {
			seen := map[string]bool{}
			for page := 1; page <= int(test.total)/3+1; page++ {
				result := read(fmt.Sprintf("%s?q=needle&page=%d&limit=3", test.endpoint, page), test.admin)
				if result.Total != test.total || result.Page != page || result.Limit != 3 {
					t.Fatalf("unexpected page: %+v", result)
				}
				for _, p := range result.Posts {
					key := fmt.Sprintf("post-%d", p.ID)
					if seen[key] {
						t.Fatal("post repeated between pages")
					}
					seen[key] = true
					if !test.admin && p.Status != "published" {
						t.Fatal("draft exposed")
					}
				}
				for _, f := range result.Files {
					key := fmt.Sprintf("file-%d", f.ID)
					if seen[key] {
						t.Fatal("file repeated between pages")
					}
					seen[key] = true
					if !test.admin && f.IsSystem {
						t.Fatal("system file exposed")
					}
				}
				if page == 1 && (len(result.Files) != 3 || result.Files[0].ID < result.Files[1].ID) {
					t.Fatal("kind/id tie ordering changed")
				}
			}
			if int64(len(seen)) != test.total {
				t.Fatal("missing paginated matches")
			}
			result := read(test.endpoint+"?q=needle&page=1000000&limit=100", test.admin)
			if len(result.Posts)+len(result.Files) != 0 || result.Total != test.total {
				t.Fatal("out-of-range page lost exact totals")
			}
		})
	}
	for _, test := range []struct {
		path         string
		admin        bool
		posts, files int64
	}{
		{"/api/search?q=needle", false, 11, 11},
		{"/api/search?q=needle&scope=posts", false, 11, 0},
		{"/api/search?q=needle&scope=files", false, 0, 11},
		{"/api/search?q=needle&include_system=true", false, 11, 11},
		{"/api/admin/search?q=needle&include_system=false", true, 13, 11},
		{"/api/search?q=needle&category_id=0&scope=posts", false, 5, 0},
		{fmt.Sprintf("/api/search?q=needle&category_id=%d", category.ID), false, 6, 11},
		{"/api/search?q=descriptiononly", false, 0, 0},
		{"/api/admin/search?q=descriptiononly", true, 0, 13},
		{"/api/search?q=hiddenalt", false, 0, 0},
		{"/api/search?q=hiddenimage", false, 0, 0},
		{"/api/search?q=private-original", false, 0, 0},
	} {
		r := read(test.path, test.admin)
		if r.PostsTotal != test.posts || r.FilesTotal != test.files {
			t.Fatalf("totals for %s = %d/%d", test.path, r.PostsTotal, r.FilesTotal)
		}
	}
	for _, q := range []string{"BODYONLY", "中", "xy", "Äpfel", "Éclair", "100%", "a_b", `C:\temp`} {
		r := read("/api/search?scope=posts&q="+url.QueryEscape(q), false)
		if r.Total != 11 {
			t.Fatalf("literal search %q total %d", q, r.Total)
		}
	}
	for _, pair := range [][2]string{{"Äpfel", "äpfel"}, {"Éclair", "éclair"}} {
		var matches bool
		if err := db.Raw("SELECT ?::text ILIKE ?", pair[0], "%"+pair[1]+"%").Scan(&matches).Error; err != nil {
			t.Fatal(err)
		}
		var expected int64
		if matches {
			expected = 11
		}
		if result := read("/api/search?scope=posts&q="+url.QueryEscape(pair[1]), false); result.Total != expected {
			t.Fatal("non-ASCII case matching diverged from database collation")
		}
	}
	for _, q := range []string{"a%b", "a_b_missing", `C:\other`} {
		if r := read("/api/search?q="+url.QueryEscape(q), false); r.Total != 0 {
			t.Fatalf("wildcard query %q expanded", q)
		}
	}
	if err := db.Model(&category).Update("name", "renamedcategoryneedle").Error; err != nil {
		t.Fatal(err)
	}
	if r := read("/api/search?q=renamedcategoryneedle&scope=posts", false); r.Total != 6 {
		t.Fatal("category rename was not immediately searchable")
	}
	// A publication edit changes the public timeline; an ordinary draft update changes the administrator timeline.
	later := stamp.Add(time.Hour)
	if err := db.Model(&posts[0]).UpdateColumn("last_edited_at", later).Error; err != nil {
		t.Fatal(err)
	}
	if r := read("/api/search?q=needle&limit=1", false); len(r.Posts) != 1 || r.Posts[0].ID != posts[0].ID {
		t.Fatal("public edited timeline ignored")
	}
	if err := db.Model(&posts[11]).Update("updated_at", later.Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if r := read("/api/admin/search?q=needle&limit=1", true); len(r.Posts) != 1 || r.Posts[0].ID != posts[11].ID {
		t.Fatal("administrator updated timeline ignored")
	}
	for _, test := range []struct{ query, code string }{
		{"page=0", "invalid_page"}, {"page=1000001", "invalid_page"}, {"page=-1", "invalid_page"}, {"page=1x", "invalid_page"}, {"page=1.1", "invalid_page"}, {"page=%2B1", "invalid_page"}, {"page=", "invalid_page"}, {"page=999999999999999999999", "invalid_page"},
		{"limit=0", "invalid_limit"}, {"limit=101", "invalid_limit"}, {"limit=no", "invalid_limit"}, {"limit=", "invalid_limit"},
	} {
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/search?q=needle&"+test.query, nil, auth, false)
		requireAPIError(t, response.Code, response.Body.Bytes(), 400, test.code)
	}
	unauthenticated := performJSONRequest(t, router, http.MethodGet, "/api/admin/search?q=needle", nil, nil, false)
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatal("administrator search did not require authentication")
	}
}

func TestSearchMaximumPageAndDatabaseFailure(t *testing.T) {
	db := requireTestDatabase(t)
	if err := db.Exec(`INSERT INTO posts(title,slug,content,search_text,status,published_at,created_at,updated_at)
 SELECT 'maxneedle', 'max-'||i, 'visible', 'visible', 'published', NOW(), NOW(), NOW() FROM generate_series(1,130) i`).Error; err != nil {
		t.Fatal(err)
	}
	router := SetupRouter()
	for page := 1; page <= 2; page++ {
		response := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/search?q=maxneedle&scope=posts&page=%d&limit=100", page), nil, nil, false)
		var result search.Result
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		expected := 100
		if page == 2 {
			expected = 30
		}
		if response.Code != 200 || len(result.Posts) != expected || result.Total != 130 {
			t.Fatal("maximum-size page has incorrect rows or total")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/search?q=maxneedle", nil))
	requireAPIError(t, response.Code, response.Body.Bytes(), 500, "database_error")
	if response.Header().Get("Cache-Control") != httpcache.NoStorePolicy {
		t.Fatal("failed search was publicly cacheable")
	}
}

func TestSearchCountsAndPageShareAConcurrentWriteSnapshot(t *testing.T) {
	db := requireTestDatabase(t)
	stamp := time.Now().UTC()
	post := models.Post{Title: "snapshotneedle", Slug: "snapshot", Content: "body", SearchText: "body", Status: "published", PublishedAt: &stamp}
	file := models.File{Name: "snapshot.txt", OrigName: "snapshot.txt", DisplayName: "snapshotneedle", Path: "snapshot.txt"}
	if err := db.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		for i := 0; ctx.Err() == nil; i++ {
			hidden := i%2 == 0
			status := "published"
			if hidden {
				status = "draft"
			}
			err := db.Transaction(func(tx *gorm.DB) error {
				if err := tx.Model(&models.Post{}).Where("id=?", post.ID).UpdateColumn("status", status).Error; err != nil {
					return err
				}
				return tx.Model(&models.File{}).Where("id=?", file.ID).UpdateColumn("is_system", hidden).Error
			})
			if err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	var inconsistent bool
	for i := 0; i < 80; i++ {
		result, err := search.Read(db, search.Options{Query: "snapshotneedle", Scope: "all", Page: 1, Limit: 100})
		if err != nil {
			cancel()
			<-done
			t.Fatal(err)
		}
		if (result.Total != 0 && result.Total != 2) || int(result.Total) != len(result.Posts)+len(result.Files) || result.PostsTotal != result.FilesTotal {
			inconsistent = true
			break
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if inconsistent {
		t.Fatal("totals, visibility and hydrated page used different snapshots")
	}
}

func TestArticleWritesSynchronizeSearchText(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "search-writer", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "search-writer", "correct-password")
	created := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", map[string]any{"title": "Article", "slug": "synchronized", "content": "**firstneedle** ![hidden](image.png)", "status": "draft"}, auth, true)
	if created.Code != 201 {
		t.Fatalf("create status %d: %s", created.Code, created.Body.String())
	}
	var post models.Post
	if err := db.Where("slug = ?", "synchronized").First(&post).Error; err != nil {
		t.Fatal(err)
	}
	if post.SearchText != "firstneedle" {
		t.Fatalf("created search text %q", post.SearchText)
	}
	path := fmt.Sprintf("/api/admin/posts/%d", post.ID)
	for _, patch := range []map[string]any{{"title": "Renamed"}, {"content": "[secondneedle](target.png)"}, {"content": "![hidden](image.png)"}} {
		patch["version"] = post.Version
		updated := performJSONRequest(t, router, http.MethodPut, path, patch, auth, true)
		if updated.Code != 200 {
			t.Fatalf("update status %d: %s", updated.Code, updated.Body.String())
		}
		if err := db.First(&post, post.ID).Error; err != nil {
			t.Fatal(err)
		}
		if post.SearchText != searchtext.Extract(post.Content) {
			t.Fatal("content and search text diverged")
		}
	}
	rejected := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"search_text": "injected"}, auth, true)
	requireAPIError(t, rejected.Code, rejected.Body.Bytes(), 400, "invalid_json")
}
