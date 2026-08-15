package routes

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
)

const routeTestPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func performFileUpload(t *testing.T, router http.Handler, filename string, content []byte, auth *requestAuth, system bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart body: %v", err)
	}
	path := "/api/admin/files"
	if system {
		path += "?system=true"
	}
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	for _, cookie := range auth.cookies {
		req.AddCookie(cookie)
	}
	req.Header.Set("X-CSRF-Token", auth.csrfToken)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestFileUploadStorageAndServingSecurity(t *testing.T) {
	uploadRoot := t.TempDir()
	t.Setenv("UPLOAD_DIR", uploadRoot)
	t.Setenv("MAX_UPLOAD_BYTES", "1024")
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "file-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "file-admin", "correct-password-123")
	png, err := base64.StdEncoding.DecodeString(routeTestPNGBase64)
	if err != nil {
		t.Fatalf("decode PNG fixture: %v", err)
	}

	upload := performFileUpload(t, router, "avatar.png", png, auth, true)
	if upload.Code != http.StatusCreated {
		t.Fatalf("upload status = %d; body=%s", upload.Code, upload.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(upload.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	if _, exposed := response["path"]; exposed {
		t.Fatal("upload response exposed the storage path")
	}
	if _, exposed := response["name"]; exposed {
		t.Fatal("upload response exposed the storage key")
	}
	fileID := uint(response["id"].(float64))
	var record models.File
	if err := db.First(&record, fileID).Error; err != nil {
		t.Fatalf("load uploaded record: %v", err)
	}
	if record.Path != record.Name || !regexp.MustCompile(`^[0-9a-f]{32}\.png$`).MatchString(record.Name) {
		t.Fatalf("stored name/path = %q/%q", record.Name, record.Path)
	}
	if _, err := os.Stat(filepath.Join(uploadRoot, record.Name)); err != nil {
		t.Fatalf("stored content: %v", err)
	}

	view := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/files/%d/view", fileID), nil, nil, false)
	if view.Code != http.StatusOK || view.Header().Get("Content-Type") != "image/png" || !strings.HasPrefix(view.Header().Get("Content-Disposition"), "inline") {
		t.Fatalf("view response status=%d headers=%v", view.Code, view.Header())
	}
	if view.Header().Get("X-Content-Type-Options") != "nosniff" || view.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("missing hardened view headers: %v", view.Header())
	}
	download := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/files/%d/download", fileID), nil, nil, false)
	if download.Code != http.StatusOK || !strings.HasPrefix(download.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("download response status=%d headers=%v", download.Code, download.Header())
	}

	textUpload := performFileUpload(t, router, "notes.txt", []byte("safe notes"), auth, false)
	if textUpload.Code != http.StatusCreated {
		t.Fatalf("text upload status = %d; body=%s", textUpload.Code, textUpload.Body.String())
	}
	var textRecord models.File
	if err := json.Unmarshal(textUpload.Body.Bytes(), &textRecord); err != nil {
		t.Fatalf("decode text upload: %v", err)
	}
	textView := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/files/%d/view", textRecord.ID), nil, nil, false)
	if !strings.HasPrefix(textView.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("text view was not forced to download: %v", textView.Header())
	}
	setting := models.Setting{Key: "download_reference", Value: fmt.Sprintf("/api/files/%d/download", textRecord.ID)}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatalf("create file reference setting: %v", err)
	}
	settingDelete := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), nil, auth, true)
	requireAPIError(t, settingDelete.Code, settingDelete.Body.Bytes(), http.StatusConflict, "file_in_use")
	if err := db.Delete(&setting).Error; err != nil {
		t.Fatalf("delete file reference setting: %v", err)
	}

	for _, test := range []struct {
		name     string
		filename string
		content  []byte
		status   int
		code     string
	}{
		{name: "spoofed image", filename: "payload.png", content: []byte("<!doctype html><script>alert(1)</script>"), status: http.StatusUnsupportedMediaType, code: "unsupported_file_type"},
		{name: "active SVG", filename: "payload.svg", content: []byte("<svg><script>alert(1)</script></svg>"), status: http.StatusUnsupportedMediaType, code: "unsupported_file_type"},
		{name: "oversized", filename: "large.txt", content: bytes.Repeat([]byte("a"), 1025), status: http.StatusRequestEntityTooLarge, code: "file_too_large"},
		{name: "empty", filename: "empty.txt", content: nil, status: http.StatusBadRequest, code: "empty_file"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := performFileUpload(t, router, test.filename, test.content, auth, false)
			requireAPIError(t, result.Code, result.Body.Bytes(), test.status, test.code)
		})
	}

	post := models.Post{Title: "Uses file", Slug: "uses-file", Content: fmt.Sprintf("![avatar](/api/files/%d/view)", fileID), Status: "draft"}
	if err := db.Create(&post).Error; err != nil {
		t.Fatalf("create referencing post: %v", err)
	}
	blockedDelete := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/files/%d", fileID), nil, auth, true)
	requireAPIError(t, blockedDelete.Code, blockedDelete.Body.Bytes(), http.StatusConflict, "file_in_use")
	if err := db.Delete(&post).Error; err != nil {
		t.Fatalf("delete referencing post: %v", err)
	}
	allowedDelete := performJSONRequest(t, router, http.MethodDelete, fmt.Sprintf("/api/admin/files/%d", fileID), nil, auth, true)
	if allowedDelete.Code != http.StatusOK {
		t.Fatalf("delete status = %d; body=%s", allowedDelete.Code, allowedDelete.Body.String())
	}
	if _, err := os.Stat(filepath.Join(uploadRoot, record.Name)); !os.IsNotExist(err) {
		t.Fatalf("deleted content still exists: %v", err)
	}
}

func TestFileStorageHealthAndPathConfinement(t *testing.T) {
	uploadRoot := t.TempDir()
	t.Setenv("UPLOAD_DIR", uploadRoot)
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "storage-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "storage-admin", "correct-password-123")

	outsideRoot := t.TempDir()
	outsidePath := filepath.Join(outsideRoot, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("must remain private"), 0o600); err != nil {
		t.Fatalf("write outside content: %v", err)
	}
	missing := models.File{Name: "../outside.txt", OrigName: "outside.txt", Path: outsidePath, Size: 19, MimeType: "text/plain"}
	if err := db.Create(&missing).Error; err != nil {
		t.Fatalf("create unsafe legacy record: %v", err)
	}
	view := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/files/%d/view", missing.ID), nil, nil, false)
	requireAPIError(t, view.Code, view.Body.Bytes(), http.StatusNotFound, "file_content_not_found")
	if _, err := os.Stat(outsidePath); err != nil {
		t.Fatalf("outside content was touched: %v", err)
	}

	orphanKey := "orphan.txt"
	if err := os.WriteFile(filepath.Join(uploadRoot, orphanKey), []byte("orphan"), 0o600); err != nil {
		t.Fatalf("write orphaned content: %v", err)
	}
	health := performJSONRequest(t, router, http.MethodGet, "/api/admin/files/storage-health", nil, auth, false)
	if health.Code != http.StatusOK {
		t.Fatalf("storage health status = %d; body=%s", health.Code, health.Body.String())
	}
	var result struct {
		MissingContent []struct {
			ID       uint   `json:"id"`
			OrigName string `json:"orig_name"`
		} `json:"missing_content"`
		OrphanedContent []string `json:"orphaned_content"`
	}
	if err := json.Unmarshal(health.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode storage health: %v", err)
	}
	if len(result.MissingContent) != 1 || result.MissingContent[0].ID != missing.ID {
		t.Fatalf("missing content report = %+v", result.MissingContent)
	}
	if len(result.OrphanedContent) != 1 || result.OrphanedContent[0] != orphanKey {
		t.Fatalf("orphaned content report = %+v", result.OrphanedContent)
	}
}
