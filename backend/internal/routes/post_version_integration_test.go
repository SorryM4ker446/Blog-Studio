package routes

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"blog-backend/internal/models"

	"gorm.io/gorm"
)

func TestArticleUpdateValidationAndRollbackPreserveVersions(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "version-validation", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "version-validation", "correct-password")
	post := models.Post{Title: "Original", Slug: "version-validation", Content: "Body"}
	other := models.Post{Title: "Other", Slug: "occupied-slug", Content: "Body"}
	if err := db.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/admin/posts/%d", post.ID)
	invalidID := performJSONRequest(t, router, http.MethodPut, "/api/admin/posts/invalid", map[string]any{"version": 1, "title": "Invalid"}, auth, true)
	if invalidID.Code != http.StatusBadRequest {
		t.Fatalf("invalid article ID: %d", invalidID.Code)
	}
	for _, tc := range []struct {
		patch  map[string]any
		status int
		code   string
	}{
		{map[string]any{}, 400, "empty_update"},
		{map[string]any{"title": " "}, 400, "invalid_title"},
		{map[string]any{"slug": "---"}, 400, "invalid_slug"},
		{map[string]any{"slug": other.Slug}, 409, "slug_conflict"},
		{map[string]any{"summary": strings.Repeat("x", 10001)}, 400, "invalid_summary"},
		{map[string]any{"content": " "}, 400, "invalid_content"},
		{map[string]any{"content": strings.Repeat("x", 1000001)}, 400, "invalid_content"},
		{map[string]any{"category_id": 999999}, 400, "invalid_category"},
	} {
		tc.patch["version"] = post.Version
		response := performJSONRequest(t, router, http.MethodPut, path, tc.patch, auth, true)
		requireAPIError(t, response.Code, response.Body.Bytes(), tc.status, tc.code)
	}
	legacyCreate := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", map[string]any{"title": "Legacy", "content": "Body", "status": "published"}, auth, true)
	requireAPIError(t, legacyCreate.Code, legacyCreate.Body.Bytes(), 400, "invalid_status")
	missing := performJSONRequest(t, router, http.MethodPut, "/api/admin/posts/999999", map[string]any{"version": 1, "title": "Missing"}, auth, true)
	requireAPIError(t, missing.Code, missing.Body.Bytes(), 404, "post_not_found")
	state := performJSONRequest(t, router, http.MethodPost, path+"/unpublish", map[string]any{"version": 1}, auth, true)
	requireAPIError(t, state.Code, state.Body.Bytes(), 409, "post_state_conflict")
	queries := 0
	if err := db.Callback().Query().Before("gorm:query").Register("fail_article_reload", func(tx *gorm.DB) {
		if tx.Statement.Table == "posts" {
			queries++
			if queries == 2 {
				tx.AddError(errors.New("injected reload failure"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	response := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"version": 1, "title": "Must roll back"}, auth, true)
	if err := db.Callback().Query().Remove("fail_article_reload"); err != nil {
		t.Fatal(err)
	}
	requireAPIError(t, response.Code, response.Body.Bytes(), 500, "database_error")
	var current models.Post
	if err := db.First(&current, post.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Version != 1 || current.Title != post.Title {
		t.Fatal("failed update advanced version or changed content")
	}
	updated := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"version": 1, "slug": "updated-slug", "category_id": 0}, auth, true)
	if updated.Code != 200 {
		t.Fatalf("retry failed: %s", updated.Body.String())
	}
	if err := json.Unmarshal(updated.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if current.Version != 2 || current.Status != "draft" {
		t.Fatal("ordinary update changed publication state or lost version")
	}
	if err := db.Callback().Query().Before("gorm:query").Register("fail_article_load", func(tx *gorm.DB) {
		if tx.Statement.Table == "posts" {
			tx.AddError(errors.New("injected article read failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	loadFailure := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"version": 2, "title": "Unchanged"}, auth, true)
	if err := db.Callback().Query().Remove("fail_article_load"); err != nil {
		t.Fatal(err)
	}
	requireAPIError(t, loadFailure.Code, loadFailure.Body.Bytes(), 500, "database_error")
	if err := db.Callback().Query().After("gorm:query").Register("delete_article_after_load", func(tx *gorm.DB) {
		if tx.Statement.Table == "posts" {
			tx.AddError(db.Exec("DELETE FROM posts WHERE id = ?", post.ID).Error)
		}
	}); err != nil {
		t.Fatal(err)
	}
	deletedDuringSave := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"version": 2, "title": "Already deleted"}, auth, true)
	if err := db.Callback().Query().Remove("delete_article_after_load"); err != nil {
		t.Fatal(err)
	}
	requireAPIError(t, deletedDuringSave.Code, deletedDuringSave.Body.Bytes(), 404, "post_not_found")
}

func TestArticleVersionsProtectConcurrentWritesAndPublication(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "version-writer", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "version-writer", "correct-password")
	created := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", map[string]any{"title": "Versioned", "content": "Original"}, auth, true)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var post models.Post
	if err := json.Unmarshal(created.Body.Bytes(), &post); err != nil {
		t.Fatal(err)
	}
	if post.Version != 1 || post.Status != "draft" {
		t.Fatalf("created version/state: %+v", post)
	}
	path := fmt.Sprintf("/api/admin/posts/%d", post.ID)
	for _, value := range []any{nil, 0, -1, 1.5, "1", 9007199254740992} {
		response := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"title": "Invalid", "version": value}, auth, true)
		if response.Code != 400 {
			t.Fatalf("invalid version %v: %d", value, response.Code)
		}
	}
	legacy := performJSONRequest(t, router, http.MethodPut, path, map[string]any{"version": 1, "status": "published"}, auth, true)
	requireAPIError(t, legacy.Code, legacy.Body.Bytes(), 400, "status_change_requires_action")
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for _, action := range []string{"save", "publish"} {
		wg.Add(1)
		go func(action string) {
			defer wg.Done()
			<-start
			method, endpoint := http.MethodPut, path
			if action == "publish" {
				method, endpoint = http.MethodPost, path+"/publish"
			}
			response := performJSONRequest(t, router, method, endpoint, map[string]any{"version": 1, "content": action}, auth, true)
			responses <- response
		}(action)
	}
	close(start)
	wg.Wait()
	close(responses)
	counts := map[int]int{}
	for response := range responses {
		if response.Code == 409 {
			requireAPIError(t, response.Code, response.Body.Bytes(), 409, "post_version_conflict")
		}
		counts[response.Code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent results: %v", counts)
	}
	if err := db.First(&post, post.ID).Error; err != nil {
		t.Fatal(err)
	}
	if post.Version != 2 {
		t.Fatalf("version after concurrent writes: %d", post.Version)
	}
	for _, action := range []string{"publish", "unpublish"} {
		response := performJSONRequest(t, router, http.MethodPost, path+"/"+action, map[string]any{"version": 1}, auth, true)
		requireAPIError(t, response.Code, response.Body.Bytes(), 409, "post_version_conflict")
		anonymous := performJSONRequest(t, router, http.MethodPost, path+"/"+action, map[string]any{"version": 2}, nil, false)
		if anonymous.Code != 401 {
			t.Fatalf("anonymous %s: %d", action, anonymous.Code)
		}
	}
	if post.Status == "draft" {
		published := performJSONRequest(t, router, http.MethodPost, path+"/publish", map[string]any{"version": post.Version}, auth, true)
		if published.Code != 200 {
			t.Fatalf("publish: %s", published.Body.String())
		}
		if err := json.Unmarshal(published.Body.Bytes(), &post); err != nil {
			t.Fatal(err)
		}
	}
	rejected := performJSONRequest(t, router, http.MethodPost, path+"/unpublish", map[string]any{"version": post.Version, "title": "Must not save"}, auth, true)
	requireAPIError(t, rejected.Code, rejected.Body.Bytes(), 400, "invalid_unpublish")
	before := post
	withdrawn := performJSONRequest(t, router, http.MethodPost, path+"/unpublish", map[string]any{"version": post.Version}, auth, true)
	if withdrawn.Code != 200 {
		t.Fatalf("unpublish: %s", withdrawn.Body.String())
	}
	if err := json.Unmarshal(withdrawn.Body.Bytes(), &post); err != nil {
		t.Fatal(err)
	}
	if post.Content != before.Content || post.Title != before.Title || post.Status != "draft" || post.Version != before.Version+1 || !post.PublishedAt.Equal(*before.PublishedAt) {
		t.Fatal("unpublish changed content or lost version/timeline")
	}
	public := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/posts/%d", post.ID), nil, nil, false)
	requireAPIError(t, public.Code, public.Body.Bytes(), 404, "post_not_found")
}

func TestCategoryDeletionInvalidatesArticleVersionsWithoutEditingTimeline(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "category-version-writer", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "category-version-writer", "correct-password")
	category := models.Category{Name: "Removed category"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	post := models.Post{Title: "Article", Slug: "version-category", Content: "Body", CategoryID: &category.ID}
	if err := db.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	// Compare persisted timestamps at PostgreSQL precision.
	if err := db.First(&post, post.ID).Error; err != nil {
		t.Fatal(err)
	}
	deleted := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/categories/%d", category.ID), nil, auth, true)
	if deleted.Code != 200 {
		t.Fatalf("delete category: %s", deleted.Body.String())
	}
	var current models.Post
	if err := db.First(&current, post.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.Version != post.Version+1 || current.CategoryID != nil || !current.UpdatedAt.Equal(post.UpdatedAt) || current.LastEditedAt != nil {
		t.Fatal("category deletion lost version or changed timestamps")
	}
	stale := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", post.ID), map[string]any{"version": post.Version, "title": "Stale"}, auth, true)
	requireAPIError(t, stale.Code, stale.Body.Bytes(), 409, "post_version_conflict")
}

func TestCategoryDeletionCompetesWithVersionedArticleSave(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "category-race-writer", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "category-race-writer", "correct-password")
	category := models.Category{Name: "Concurrent deletion"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatal(err)
	}
	post := models.Post{Title: "Concurrent article", Slug: "category-race", Content: "Original", CategoryID: &category.ID}
	if err := db.Create(&post).Error; err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	saved := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		<-start
		response := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", post.ID), map[string]any{"version": post.Version, "content": "Changed"}, auth, true)
		saved <- response
	}()
	close(start)
	deleted := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/categories/%d", category.ID), nil, auth, true)
	response := <-saved
	saveCode := response.Code
	if saveCode == 409 {
		requireAPIError(t, response.Code, response.Body.Bytes(), 409, "post_version_conflict")
	}
	if deleted.Code != 200 || (saveCode != 200 && saveCode != 409) {
		t.Fatalf("delete/save statuses: %d/%d", deleted.Code, saveCode)
	}
	var current models.Post
	if err := db.First(&current, post.ID).Error; err != nil {
		t.Fatal(err)
	}
	expectedVersion, expectedContent := post.Version+1, post.Content
	if saveCode == 200 {
		expectedVersion++
		expectedContent = "Changed"
	}
	if current.CategoryID != nil || current.Version != expectedVersion || current.Content != expectedContent {
		t.Fatal("concurrent deletion and save lost an update or a version increment")
	}
}
