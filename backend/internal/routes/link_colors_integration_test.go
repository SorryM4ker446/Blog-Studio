package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"blog-backend/internal/models"
)

func TestCustomLinkColorsPersistAndRejectInvalidValues(t *testing.T) {
	db := requireTestDatabase(t)
	createTestUser(t, db, "colors-admin", "correct-password", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "colors-admin", "correct-password")
	input := map[string]any{"title": "Custom", "url": "https://example.com", "icon": "star", "color": "#AB12EF", "visible": true, "request_id": "custom-color-test-0001"}
	for attempt := 0; attempt < 2; attempt++ {
		response := performJSONRequest(t, router, http.MethodPost, "/api/admin/links", input, auth, true)
		if response.Code != 201 {
			t.Fatalf("create/retry: %s", response.Body.String())
		}
	}
	var link models.Link
	if err := db.First(&link).Error; err != nil {
		t.Fatal(err)
	}
	if link.Color != "#ab12ef" {
		t.Fatalf("stored color %s", link.Color)
	}
	var count int64
	db.Model(&models.Link{}).Count(&count)
	if count != 1 {
		t.Fatal("retry duplicated custom link")
	}
	input["version"] = link.Version
	path := fmt.Sprintf("/api/admin/links/%d", link.ID)
	for _, color := range []string{"#abc", "#12345678", "#gggggg", "purple", "var(--accent-blue)", "#123456\n"} {
		input["color"] = color
		response := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
		if response.Code != 400 {
			t.Fatalf("invalid color %q: %d", color, response.Code)
		}
	}
	input["color"] = "#012345"
	response := performJSONRequest(t, router, http.MethodPut, path, input, auth, true)
	if response.Code != 200 {
		t.Fatalf("update: %s", response.Body.String())
	}
	for _, endpoint := range []string{"/api/links", "/api/admin/links"} {
		response = performJSONRequest(t, router, http.MethodGet, endpoint, nil, auth, false)
		var links []models.Link
		if err := json.Unmarshal(response.Body.Bytes(), &links); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || len(links) != 1 || links[0].Color != "#012345" {
			t.Fatalf("read: %s", response.Body.String())
		}
	}
}
