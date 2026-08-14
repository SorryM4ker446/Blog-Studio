package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
)

type apiErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func TestStage3LegacyMigrationBackfill(t *testing.T) {
	db := requireTestDatabase(t)
	for _, constraint := range []struct {
		table string
		name  string
	}{
		{"posts", "fk_posts_category"},
		{"posts", "chk_posts_status"},
		{"posts", "chk_posts_publication_timestamp"},
	} {
		if err := db.Migrator().DropConstraint(constraint.table, constraint.name); err != nil {
			t.Fatalf("drop test constraint %s: %v", constraint.name, err)
		}
	}

	zeroCategoryID := uint(0)
	legacyPublished := models.Post{
		Title: "Legacy published", Slug: "legacy-published", Content: "content",
		CategoryID: &zeroCategoryID, Status: "published",
	}
	legacyInvalid := models.Post{
		Title: "Legacy invalid", Slug: "legacy-invalid", Content: "content", Status: "archived",
	}
	if err := db.Create(&[]models.Post{legacyPublished, legacyInvalid}).Error; err != nil {
		t.Fatalf("create legacy posts: %v", err)
	}
	if err := config.Migrate(db); err != nil {
		t.Fatalf("migrate legacy posts: %v", err)
	}

	var migrated []models.Post
	if err := db.Order("slug ASC").Find(&migrated).Error; err != nil {
		t.Fatalf("load migrated posts: %v", err)
	}
	if len(migrated) != 2 {
		t.Fatalf("migrated post count = %d, want 2", len(migrated))
	}
	bySlug := map[string]models.Post{migrated[0].Slug: migrated[0], migrated[1].Slug: migrated[1]}
	if post := bySlug["legacy-published"]; post.CategoryID != nil || post.Status != "published" || post.PublishedAt == nil {
		t.Fatalf("migrated published post = %+v", post)
	}
	if post := bySlug["legacy-invalid"]; post.Status != "draft" || post.PublishedAt != nil {
		t.Fatalf("migrated invalid-status post = %+v", post)
	}
	for _, name := range []string{"fk_posts_category", "chk_posts_status", "chk_posts_publication_timestamp"} {
		if !db.Migrator().HasConstraint("posts", name) {
			t.Fatalf("constraint %s was not restored", name)
		}
	}
}

func requireAPIError(t *testing.T, responseCode int, body []byte, expectedStatus int, expectedCode string) {
	t.Helper()
	if responseCode != expectedStatus {
		t.Fatalf("status = %d, want %d; body=%s", responseCode, expectedStatus, string(body))
	}
	var response apiErrorResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode API error: %v; body=%s", err, string(body))
	}
	if response.Code != expectedCode || response.Error == "" {
		t.Fatalf("API error = %+v, want code %q and a message", response, expectedCode)
	}
}

func TestStage3QueryParameterValidation(t *testing.T) {
	requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	router := SetupRouter()

	tests := []struct {
		path string
		code string
	}{
		{"/api/posts?page=abc", "invalid_page"},
		{"/api/posts?limit=101", "invalid_limit"},
		{"/api/posts?category_id=-1", "invalid_category_id"},
		{"/api/posts?sort=admin", "invalid_sort"},
		{"/api/posts/not-a-number", "invalid_id"},
		{"/api/files?page=0", "invalid_page"},
		{"/api/search?q=%20%20", "missing_query"},
		{"/api/search?q=test&scope=unknown", "invalid_scope"},
	}
	for _, test := range tests {
		t.Run(test.code+test.path, func(t *testing.T) {
			response := performJSONRequest(t, router, http.MethodGet, test.path, nil, nil, false)
			requireAPIError(t, response.Code, response.Body.Bytes(), http.StatusBadRequest, test.code)
		})
	}
}

func TestStage3PostRulesAndSlugConflicts(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "domain-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "domain-admin", "correct-password-123")

	invalidRequests := []struct {
		name string
		body map[string]any
		code string
	}{
		{"blank title", map[string]any{"title": "  ", "content": "content"}, "invalid_title"},
		{"blank content", map[string]any{"title": "Title", "content": "  "}, "invalid_content"},
		{"invalid status", map[string]any{"title": "Title", "content": "content", "status": "archived"}, "invalid_status"},
		{"missing category", map[string]any{"title": "Title", "content": "content", "category_id": 999999}, "invalid_category"},
		{"unknown field", map[string]any{"title": "Title", "content": "content", "published_at": time.Now()}, "invalid_json"},
	}
	for _, test := range invalidRequests {
		t.Run(test.name, func(t *testing.T) {
			response := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", test.body, auth, true)
			requireAPIError(t, response.Code, response.Body.Bytes(), http.StatusBadRequest, test.code)
		})
	}

	create := func(title string, extra map[string]any) models.Post {
		t.Helper()
		body := map[string]any{"title": title, "content": "# Body", "status": "draft"}
		for key, value := range extra {
			body[key] = value
		}
		response := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", body, auth, true)
		if response.Code != http.StatusCreated {
			t.Fatalf("create post status = %d; body=%s", response.Code, response.Body.String())
		}
		var post models.Post
		if err := json.Unmarshal(response.Body.Bytes(), &post); err != nil {
			t.Fatalf("decode created post: %v", err)
		}
		return post
	}

	first := create("Repeated title", nil)
	second := create("Repeated title", nil)
	if first.Slug != "repeated-title" || second.Slug != "repeated-title-2" {
		t.Fatalf("generated slugs = %q, %q", first.Slug, second.Slug)
	}
	conflict := performJSONRequest(t, router, http.MethodPost, "/api/admin/posts", map[string]any{
		"title": "Explicit conflict", "slug": "Repeated Title", "content": "content",
	}, auth, true)
	requireAPIError(t, conflict.Code, conflict.Body.Bytes(), http.StatusConflict, "slug_conflict")

	publish := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", first.ID), map[string]any{
		"status": "published",
	}, auth, true)
	if publish.Code != http.StatusOK {
		t.Fatalf("publish status = %d; body=%s", publish.Code, publish.Body.String())
	}
	var published models.Post
	if err := json.Unmarshal(publish.Body.Bytes(), &published); err != nil || published.PublishedAt == nil || published.LastEditedAt != nil {
		t.Fatalf("published post = %+v; decode error=%v", published, err)
	}
	originalPublishedAt := *published.PublishedAt

	edit := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", first.ID), map[string]any{
		"summary": "edited while published",
	}, auth, true)
	if edit.Code != http.StatusOK {
		t.Fatalf("published edit status = %d; body=%s", edit.Code, edit.Body.String())
	}
	if err := json.Unmarshal(edit.Body.Bytes(), &published); err != nil || published.PublishedAt == nil || !published.PublishedAt.Equal(originalPublishedAt) || published.LastEditedAt == nil {
		t.Fatalf("published timestamps after edit: published_before=%s post=%+v error=%v", originalPublishedAt, published, err)
	}
	originalLastEditedAt := *published.LastEditedAt

	unpublish := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", first.ID), map[string]any{
		"status": "draft",
	}, auth, true)
	if unpublish.Code != http.StatusOK {
		t.Fatalf("unpublish status = %d; body=%s", unpublish.Code, unpublish.Body.String())
	}
	if err := json.Unmarshal(unpublish.Body.Bytes(), &published); err != nil || published.PublishedAt == nil || !published.PublishedAt.Equal(originalPublishedAt) || published.LastEditedAt == nil || !published.LastEditedAt.Equal(originalLastEditedAt) {
		t.Fatalf("unpublished post lost timeline: %+v; error=%v", published, err)
	}
	draftEdit := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", first.ID), map[string]any{
		"summary": "edited while temporarily unpublished",
	}, auth, true)
	if draftEdit.Code != http.StatusOK {
		t.Fatalf("draft edit status = %d; body=%s", draftEdit.Code, draftEdit.Body.String())
	}
	if err := json.Unmarshal(draftEdit.Body.Bytes(), &published); err != nil || published.PublishedAt == nil || !published.PublishedAt.Equal(originalPublishedAt) || published.LastEditedAt == nil || !published.LastEditedAt.After(originalLastEditedAt) {
		t.Fatalf("draft edit did not advance last_edited_at: %+v; error=%v", published, err)
	}
	latestEditedAt := *published.LastEditedAt

	republish := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/posts/%d", first.ID), map[string]any{
		"status": "published",
	}, auth, true)
	if republish.Code != http.StatusOK {
		t.Fatalf("republish status = %d; body=%s", republish.Code, republish.Body.String())
	}
	if err := json.Unmarshal(republish.Body.Bytes(), &published); err != nil || published.PublishedAt == nil || !published.PublishedAt.Equal(originalPublishedAt) || published.LastEditedAt == nil || !published.LastEditedAt.Equal(latestEditedAt) {
		t.Fatalf("republished post reset timeline: %+v; error=%v", published, err)
	}

	missingDelete := performJSONRequest(t, router, http.MethodDelete, "/api/admin/posts/999999", nil, auth, true)
	requireAPIError(t, missingDelete.Code, missingDelete.Body.Bytes(), http.StatusNotFound, "post_not_found")
}

func TestStage3PublicPostsUseEffectiveTimelineOrder(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)

	now := time.Now()
	oldPublication := now.Add(-72 * time.Hour)
	middlePublication := now.Add(-48 * time.Hour)
	recentEdit := now.Add(-24 * time.Hour)
	recentPublication := now.Add(-12 * time.Hour)
	posts := []models.Post{
		{Title: "Timeline old", Slug: "timeline-old", Content: "timeline", Status: "published", PublishedAt: &oldPublication},
		{Title: "Timeline edited", Slug: "timeline-edited", Content: "timeline", Status: "published", PublishedAt: &middlePublication, LastEditedAt: &recentEdit},
		{Title: "Timeline new", Slug: "timeline-new", Content: "timeline", Status: "published", PublishedAt: &recentPublication},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("create timeline posts: %v", err)
	}

	router := SetupRouter()
	response := performJSONRequest(t, router, http.MethodGet, "/api/posts", nil, nil, false)
	if response.Code != http.StatusOK {
		t.Fatalf("list timeline posts status = %d; body=%s", response.Code, response.Body.String())
	}
	var result struct {
		Data []models.Post `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode timeline posts: %v", err)
	}
	want := []string{"timeline-new", "timeline-edited", "timeline-old"}
	if len(result.Data) != len(want) {
		t.Fatalf("timeline post count = %d, want %d", len(result.Data), len(want))
	}
	for index, slug := range want {
		if result.Data[index].Slug != slug {
			t.Fatalf("timeline order at %d = %q, want %q", index, result.Data[index].Slug, slug)
		}
	}
}

func TestStage3CategoryDeletionAndDatabaseConstraints(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "category-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "category-admin", "correct-password-123")

	category := models.Category{Name: "Consistency"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	post := models.Post{Title: "Categorized", Slug: "categorized", Content: "content", CategoryID: &category.ID, Status: "draft"}
	if err := db.Create(&post).Error; err != nil {
		t.Fatalf("create categorized post: %v", err)
	}
	categoriesResponse := performJSONRequest(t, router, http.MethodGet, "/api/admin/categories", nil, auth, false)
	if categoriesResponse.Code != http.StatusOK {
		t.Fatalf("list categories status = %d; body=%s", categoriesResponse.Code, categoriesResponse.Body.String())
	}
	var categories []models.Category
	if err := json.Unmarshal(categoriesResponse.Body.Bytes(), &categories); err != nil {
		t.Fatalf("decode categories: %v", err)
	}
	if len(categories) != 1 || categories[0].PostCount != 1 {
		t.Fatalf("categories = %+v, want one category with post_count 1", categories)
	}

	response := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/categories/%d", category.ID), nil, auth, true)
	if response.Code != http.StatusOK {
		t.Fatalf("delete category status = %d; body=%s", response.Code, response.Body.String())
	}
	if err := db.First(&post, post.ID).Error; err != nil {
		t.Fatalf("reload uncategorized post: %v", err)
	}
	if post.CategoryID != nil {
		t.Fatalf("category_id = %v, want NULL after category deletion", *post.CategoryID)
	}

	missingDelete := performJSONRequest(t, router, http.MethodDelete, "/api/admin/categories/999999", nil, auth, true)
	requireAPIError(t, missingDelete.Code, missingDelete.Body.Bytes(), http.StatusNotFound, "category_not_found")

	firstCategory := performJSONRequest(t, router, http.MethodPost, "/api/admin/categories", map[string]string{"name": "Case Name"}, auth, true)
	if firstCategory.Code != http.StatusCreated {
		t.Fatalf("create category status = %d; body=%s", firstCategory.Code, firstCategory.Body.String())
	}
	duplicateCategory := performJSONRequest(t, router, http.MethodPost, "/api/admin/categories", map[string]string{"name": " case name "}, auth, true)
	requireAPIError(t, duplicateCategory.Code, duplicateCategory.Body.Bytes(), http.StatusConflict, "category_name_conflict")

	invalidStatus := models.Post{Title: "Invalid status", Slug: "invalid-status", Content: "content", Status: "archived"}
	if err := db.Create(&invalidStatus).Error; err == nil {
		t.Fatal("database accepted an invalid post status")
	}
	missingCategoryID := uint(999999)
	orphan := models.Post{Title: "Orphan", Slug: "orphan", Content: "content", CategoryID: &missingCategoryID, Status: "draft"}
	if err := db.Create(&orphan).Error; err == nil {
		t.Fatal("database accepted a post with a missing category")
	}
	lastEditedAt := time.Now()
	neverPublishedButEdited := models.Post{Title: "Invalid edit time", Slug: "invalid-edit-time", Content: "content", Status: "draft", LastEditedAt: &lastEditedAt}
	if err := db.Create(&neverPublishedButEdited).Error; err == nil {
		t.Fatal("database accepted last_edited_at without a first publication time")
	}
}

func TestStage3SettingsValidationIsAtomic(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "settings-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "settings-admin", "correct-password-123")

	response := performJSONRequest(t, router, http.MethodPut, "/api/admin/settings", map[string]string{
		"valid_key": "must not be written",
		" bad_key":  "invalid",
	}, auth, true)
	requireAPIError(t, response.Code, response.Body.Bytes(), http.StatusBadRequest, "invalid_setting_key")
	var count int64
	if err := db.Model(&models.Setting{}).Where("key = ?", "valid_key").Count(&count).Error; err != nil {
		t.Fatalf("count settings: %v", err)
	}
	if count != 0 {
		t.Fatalf("valid_key count = %d, want 0 after rejected batch", count)
	}

	valid := performJSONRequest(t, router, http.MethodPut, "/api/admin/settings", map[string]string{
		"site_title":       "Consistent title",
		"site_description": strings.Repeat("x", 20),
	}, auth, true)
	if valid.Code != http.StatusOK {
		t.Fatalf("valid settings status = %d; body=%s", valid.Code, valid.Body.String())
	}
	if err := db.Model(&models.Setting{}).Where("key IN ?", []string{"site_title", "site_description"}).Count(&count).Error; err != nil {
		t.Fatalf("count saved settings: %v", err)
	}
	if count != 2 {
		t.Fatalf("saved setting count = %d, want 2", count)
	}
}
