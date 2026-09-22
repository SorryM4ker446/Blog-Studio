package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"net/http"
	"sync"
	"testing"

	"blog-backend/internal/migrations"
	"blog-backend/internal/models"
)

func TestHomepageLinksCRUDVisibilityConflictsAndOrdering(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "links-admin", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "links-admin", "correct-password")
	input := map[string]any{"title": "First", "description": "Useful link", "url": "https://example.com/first", "icon": "star", "color": "blue", "visible": true, "request_id": "test-link-create-0001"}
	anonymous := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, nil, false)
	if anonymous.Code != 401 {
		t.Fatalf("anonymous write: %d", anonymous.Code)
	}
	noCSRF := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, false)
	if noCSRF.Code != 403 {
		t.Fatalf("CSRF protection: %d", noCSRF.Code)
	}
	first := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true)
	if first.Code != 201 {
		t.Fatalf("create: %s", first.Body.String())
	}
	var a models.Link
	if err := json.Unmarshal(first.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	retry := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true)
	if retry.Code != 201 {
		t.Fatalf("retry: %s", retry.Body.String())
	}
	var count int64
	db.Model(&models.Link{}).Count(&count)
	if count != 1 {
		t.Fatal("retry duplicated link")
	}
	input["request_id"] = "test-link-create-0002"
	input["title"] = "Second"
	input["visible"] = false
	input["url"] = ""
	second := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true)
	if second.Code != 201 {
		t.Fatalf("hidden create: %s", second.Body.String())
	}
	var b models.Link
	json.Unmarshal(second.Body.Bytes(), &b)
	public := performJSONRequest(t, router, http.MethodGet, "/api/links", nil, nil, false)
	var visible []models.Link
	json.Unmarshal(public.Body.Bytes(), &visible)
	if public.Code != 200 || len(visible) != 1 || visible[0].ID != a.ID {
		t.Fatalf("public visibility: %s", public.Body.String())
	}
	movePath := fmt.Sprintf("/api/admin/links/%d/move", b.ID)
	moveInput := map[string]any{"version": b.Version, "neighbor_id": a.ID, "neighbor_version": a.Version}
	moved := performJSONRequest(t, router, http.MethodPost, movePath, moveInput, auth, true)
	if moved.Code != 200 {
		t.Fatalf("move: %s", moved.Body.String())
	}
	var ordered []models.Link
	json.Unmarshal(moved.Body.Bytes(), &ordered)
	if len(ordered) != 2 || ordered[0].ID != b.ID || ordered[1].ID != a.ID || ordered[0].Position >= ordered[1].Position {
		t.Fatalf("order: %s", moved.Body.String())
	}
	stale := performJSONRequest(t, router, http.MethodPost, movePath, moveInput, auth, true)
	if stale.Code != 409 {
		t.Fatal("stale move accepted")
	}
	path := fmt.Sprintf("/api/admin/links/%d", b.ID)
	input["version"] = 1
	input["url"] = "https://example.com/second"
	input["visible"] = true
	conflict := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
	if conflict.Code != 409 {
		t.Fatal("stale edit accepted")
	}
	input["version"] = ordered[0].Version
	updated := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
	if updated.Code != 200 {
		t.Fatalf("update: %s", updated.Body.String())
	}
	json.Unmarshal(updated.Body.Bytes(), &b)
	for _, url := range []string{"javascript:alert(1)", "data:text/html,x", "//example.com", "https://user:password@example.com", "https://example.com/a b"} {
		input["url"] = url
		input["version"] = b.Version
		invalid := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
		if invalid.Code != 400 {
			t.Fatalf("accepted invalid URL: %q", url)
		}
	}
	input["url"] = "https://example.com"
	input["icon"] = "star|grid"
	invalidIcon := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
	if invalidIcon.Code != 400 {
		t.Fatal("accepted invalid icon")
	}
	staleDelete := performJSONRequest(t, router, http.MethodDelete, path, map[string]any{"version": 1}, auth, true)
	if staleDelete.Code != 409 {
		t.Fatal("stale delete accepted")
	}
	deleted := performJSONRequest(t, router, http.MethodDelete, path, map[string]any{"version": b.Version}, auth, true)
	if deleted.Code != 200 {
		t.Fatalf("delete: %s", deleted.Body.String())
	}
	if err := migrations.Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	db.Model(&models.Link{}).Count(&count)
	if count != 1 {
		t.Fatal("migration rerun recreated removed links")
	}
}

func TestHomepageLinksConcurrentCreateAndFailedMove(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "links-race", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "links-race", "correct-password")
	input := map[string]any{"title": "Repeated request", "url": "https://example.com", "icon": "link", "color": "blue", "visible": true, "request_id": "concurrent-link-request"}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true).Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 201 {
			t.Fatalf("concurrent create status: %d", code)
		}
	}
	var links []models.Link
	db.Find(&links)
	if len(links) != 1 {
		t.Fatal("concurrent retry created duplicates")
	}
	first := links[0]
	input["request_id"] = "another-link-request"
	input["title"] = "Second"
	response := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true)
	var second models.Link
	json.Unmarshal(response.Body.Bytes(), &second)
	if err := db.Callback().Update().Before("gorm:update").Register("fail_second_link_move", func(tx *gorm.DB) {
		if link, ok := tx.Statement.Model.(*models.Link); ok && link.ID == second.ID {
			tx.AddError(errors.New("injected move failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	failed := performJSONRequest(t, router, http.MethodPost, fmt.Sprintf("/api/admin/links/%d/move", first.ID), map[string]any{"version": first.Version, "neighbor_id": second.ID, "neighbor_version": second.Version}, auth, true)
	db.Callback().Update().Remove("fail_second_link_move")
	if failed.Code != 500 {
		t.Fatalf("injected failure status: %d", failed.Code)
	}
	var restored models.Link
	db.First(&restored, first.ID)
	if restored.Position != first.Position || restored.Version != first.Version {
		t.Fatal("partial reorder escaped transaction")
	}
	createTestUser(t, db, "links-reader", "correct-password", "writer")
	reader := loginAs(t, router, "links-reader", "correct-password")
	denied := performJSONRequest(t, router, http.MethodGet, "/api/admin/links", nil, reader, false)
	if denied.Code != 403 {
		t.Fatalf("non-admin access: %d", denied.Code)
	}
}
