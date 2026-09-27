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
	"runtime"
	"strings"
	"testing"

	"blog-backend/internal/filestore"
	"blog-backend/internal/httpcache"
	"blog-backend/internal/models"
	"blog-backend/internal/searchtext"
	"github.com/gin-gonic/gin"
)

const routeTestPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func performFileUpload(t *testing.T, router http.Handler, filename string, content []byte, auth *requestAuth, system bool) *httptest.ResponseRecorder {
	return performFileUploadWithMetadata(t, router, filename, content, "", "", auth, system)
}

func performFileUploadWithMetadata(t *testing.T, router http.Handler, filename string, content []byte, displayName, description string, auth *requestAuth, system bool) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if displayName != "" {
		if err := writer.WriteField("display_name", displayName); err != nil {
			t.Fatalf("write display name: %v", err)
		}
	}
	if description != "" {
		if err := writer.WriteField("description", description); err != nil {
			t.Fatalf("write description: %v", err)
		}
	}
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
	if response["display_name"] != "avatar.png" || response["description"] != "" {
		t.Fatalf("default upload metadata = %#v", response)
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
	if view.Header().Get("Cache-Control") != httpcache.PublicFilePolicy || view.Header().Get("ETag") == "" || view.Header().Get("Last-Modified") == "" {
		t.Fatalf("missing file cache validators: %v", view.Header())
	}
	revalidate := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/files/%d/view", fileID), nil)
	revalidate.Header.Set("If-None-Match", view.Header().Get("ETag"))
	revalidated := httptest.NewRecorder()
	router.ServeHTTP(revalidated, revalidate)
	if revalidated.Code != http.StatusNotModified || revalidated.Body.Len() != 0 {
		t.Fatalf("conditional view status=%d body-bytes=%d", revalidated.Code, revalidated.Body.Len())
	}
	if revalidated.Header().Get("Cache-Control") != httpcache.PublicFilePolicy || revalidated.Header().Get("ETag") != view.Header().Get("ETag") {
		t.Fatalf("conditional view lost cache validators: %v", revalidated.Header())
	}
	download := performJSONRequest(t, router, http.MethodGet, fmt.Sprintf("/api/files/%d/download", fileID), nil, nil, false)
	if download.Code != http.StatusOK || !strings.HasPrefix(download.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("download response status=%d headers=%v", download.Code, download.Header())
	}

	textUpload := performFileUploadWithMetadata(t, router, "notes.txt", []byte("safe notes"), "Release notes", "Public launch documentation", auth, false)
	if textUpload.Code != http.StatusCreated {
		t.Fatalf("text upload status = %d; body=%s", textUpload.Code, textUpload.Body.String())
	}
	var textRecord models.File
	if err := json.Unmarshal(textUpload.Body.Bytes(), &textRecord); err != nil {
		t.Fatalf("decode text upload: %v", err)
	}
	if textRecord.DisplayName != "Release notes" || textRecord.Description != "Public launch documentation" || textRecord.OrigName != "notes.txt" {
		t.Fatalf("uploaded metadata = %#v", textRecord)
	}
	tooLongUploadName := performFileUploadWithMetadata(t, router, "notes.txt", []byte("safe notes"), strings.Repeat("名", 26), "", auth, false)
	requireAPIError(t, tooLongUploadName.Code, tooLongUploadName.Body.Bytes(), http.StatusBadRequest, "invalid_display_name")
	tooLongUploadDescription := performFileUploadWithMetadata(t, router, "notes.txt", []byte("safe notes"), "Valid name", strings.Repeat("介", 101), auth, false)
	requireAPIError(t, tooLongUploadDescription.Code, tooLongUploadDescription.Body.Bytes(), http.StatusBadRequest, "invalid_description")
	publicDisplayNameSearch := performJSONRequest(t, router, http.MethodGet, "/api/search?q=release%20notes&scope=files", nil, nil, false)
	if publicDisplayNameSearch.Code != http.StatusOK || !strings.Contains(publicDisplayNameSearch.Body.String(), `"display_name":"Release notes"`) {
		t.Fatalf("public display-name search status=%d body=%s", publicDisplayNameSearch.Code, publicDisplayNameSearch.Body.String())
	}
	for _, path := range []string{
		"/api/search?q=launch%20documentation&scope=files",
		"/api/search?q=notes.txt&scope=files",
	} {
		search := performJSONRequest(t, router, http.MethodGet, path, nil, nil, false)
		if search.Code != http.StatusOK || strings.Contains(search.Body.String(), `"display_name":"Release notes"`) {
			t.Fatalf("public file search leaked description or superseded original name: path=%s status=%d body=%s", path, search.Code, search.Body.String())
		}
	}
	adminDescriptionSearch := performJSONRequest(t, router, http.MethodGet, "/api/admin/search?q=launch%20documentation&scope=files&include_system=false", nil, auth, false)
	if adminDescriptionSearch.Code != http.StatusOK || !strings.Contains(adminDescriptionSearch.Body.String(), `"display_name":"Release notes"`) {
		t.Fatalf("admin description search status=%d body=%s", adminDescriptionSearch.Code, adminDescriptionSearch.Body.String())
	}
	adminOriginalNameSearch := performJSONRequest(t, router, http.MethodGet, "/api/admin/search?q=notes.txt&scope=files&include_system=false", nil, auth, false)
	if adminOriginalNameSearch.Code != http.StatusOK || strings.Contains(adminOriginalNameSearch.Body.String(), `"display_name":"Release notes"`) {
		t.Fatalf("admin search matched superseded original name: status=%d body=%s", adminOriginalNameSearch.Code, adminOriginalNameSearch.Body.String())
	}
	fallbackNameUpload := performFileUpload(t, router, "fallback-search.txt", []byte("plain fallback content"), auth, false)
	if fallbackNameUpload.Code != http.StatusCreated {
		t.Fatalf("fallback-name upload status=%d body=%s", fallbackNameUpload.Code, fallbackNameUpload.Body.String())
	}
	fallbackNameSearch := performJSONRequest(t, router, http.MethodGet, "/api/search?q=fallback-search&scope=files", nil, nil, false)
	if fallbackNameSearch.Code != http.StatusOK || !strings.Contains(fallbackNameSearch.Body.String(), `"display_name":"fallback-search.txt"`) {
		t.Fatalf("default original-name search status=%d body=%s", fallbackNameSearch.Code, fallbackNameSearch.Body.String())
	}
	invalidUpdate := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), map[string]any{
		"display_name": "   ",
		"description":  "invalid",
	}, auth, true)
	requireAPIError(t, invalidUpdate.Code, invalidUpdate.Body.Bytes(), http.StatusBadRequest, "invalid_display_name")
	longName := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), map[string]any{
		"display_name": strings.Repeat("名", 26),
		"description":  "Valid description",
	}, auth, true)
	requireAPIError(t, longName.Code, longName.Body.Bytes(), http.StatusBadRequest, "invalid_display_name")
	longDescription := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), map[string]any{
		"display_name": "Valid name",
		"description":  strings.Repeat("介", 101),
	}, auth, true)
	requireAPIError(t, longDescription.Code, longDescription.Body.Bytes(), http.StatusBadRequest, "invalid_description")
	atLimits := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), map[string]any{
		"display_name": strings.Repeat("名", 25),
		"description":  strings.Repeat("介", 100),
	}, auth, true)
	if atLimits.Code != http.StatusOK {
		t.Fatalf("file metadata limits rejected valid characters: status=%d body=%s", atLimits.Code, atLimits.Body.String())
	}
	updated := performJSONRequest(t, router, http.MethodPut, fmt.Sprintf("/api/admin/files/%d", textRecord.ID), map[string]any{
		"display_name": "Updated release notes",
		"description":  "A concise public description",
	}, auth, true)
	if updated.Code != http.StatusOK {
		t.Fatalf("update metadata status=%d body=%s", updated.Code, updated.Body.String())
	}
	if err := json.Unmarshal(updated.Body.Bytes(), &textRecord); err != nil {
		t.Fatalf("decode updated file: %v", err)
	}
	if textRecord.DisplayName != "Updated release notes" || textRecord.Description != "A concise public description" || textRecord.OrigName != "notes.txt" {
		t.Fatalf("updated metadata = %#v", textRecord)
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
	post.SearchText = searchtext.Extract(post.Content)
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

func TestLargeFileUploadUsesTemporaryStorageAndReportsFailures(t *testing.T) {
	uploadRoot := t.TempDir()
	t.Setenv("UPLOAD_DIR", uploadRoot)
	t.Setenv("MAX_UPLOAD_BYTES", fmt.Sprint(40<<20))
	tempDir, err := filestore.PrepareMultipartTempDir(uploadRoot)
	if err != nil {
		t.Fatal(err)
	}
	tempVariable := "TMPDIR"
	if runtime.GOOS == "windows" {
		tempVariable = "TMP"
	}
	t.Setenv(tempVariable, tempDir)
	if filepath.Clean(os.TempDir()) != filepath.Clean(tempDir) {
		t.Fatalf("multipart temporary directory = %q, want %q", os.TempDir(), tempDir)
	}
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "large-file-admin", "correct-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "large-file-admin", "correct-password-123")
	content := bytes.Repeat([]byte("a"), 33<<20)
	upload := performFileUpload(t, router, "large.txt", content, auth, false)
	if upload.Code != http.StatusCreated {
		t.Fatalf("large upload status=%d body=%s", upload.Code, upload.Body.String())
	}
	entries, err := os.ReadDir(tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("multipart temporary files remain after upload: entries=%v error=%v", entries, err)
	}
	oversized := performFileUpload(t, router, "too-large.txt", bytes.Repeat([]byte("a"), 41<<20), auth, false)
	requireAPIError(t, oversized.Code, oversized.Body.Bytes(), http.StatusRequestEntityTooLarge, "file_too_large")
	entries, err = os.ReadDir(tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("multipart temporary files remain after rejected upload: entries=%v error=%v", entries, err)
	}
	var wrongFieldBody bytes.Buffer
	wrongFieldWriter := multipart.NewWriter(&wrongFieldBody)
	wrongFieldPart, err := wrongFieldWriter.CreateFormFile("other", "another.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wrongFieldPart.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := wrongFieldWriter.Close(); err != nil {
		t.Fatal(err)
	}
	wrongFieldRequest := httptest.NewRequest(http.MethodPost, "/api/admin/files", &wrongFieldBody)
	wrongFieldRequest.Header.Set("Content-Type", wrongFieldWriter.FormDataContentType())
	for _, cookie := range auth.cookies {
		wrongFieldRequest.AddCookie(cookie)
	}
	wrongFieldRequest.Header.Set("X-CSRF-Token", auth.csrfToken)
	wrongFieldResponse := httptest.NewRecorder()
	router.ServeHTTP(wrongFieldResponse, wrongFieldRequest)
	requireAPIError(t, wrongFieldResponse.Code, wrongFieldResponse.Body.Bytes(), http.StatusBadRequest, "missing_file")
	entries, err = os.ReadDir(tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("multipart temporary files remain after invalid upload: entries=%v error=%v", entries, err)
	}

	t.Setenv(tempVariable, filepath.Join(t.TempDir(), "missing"))
	failure := performFileUpload(t, router, "another.txt", content, auth, false)
	requireAPIError(t, failure.Code, failure.Body.Bytes(), http.StatusInternalServerError, "storage_error")
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
	missing := models.File{Name: "../outside.txt", OrigName: "outside.txt", DisplayName: "Outside file", Path: outsidePath, Size: 19, MimeType: "text/plain"}
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
