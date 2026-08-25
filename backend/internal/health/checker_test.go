package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func performHealthRequest(handler gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/health", handler)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	return response
}

func TestLivenessDoesNotDependOnExternalServices(t *testing.T) {
	response := performHealthRequest(Liveness)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("liveness response = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("liveness Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestReadinessChecksDatabaseAndStorage(t *testing.T) {
	tests := []struct {
		name         string
		databaseErr  error
		storageErr   error
		wantStatus   int
		wantResponse string
	}{
		{"ready", nil, nil, http.StatusOK, `"status":"ready"`},
		{"database unavailable", errors.New("database unavailable"), nil, http.StatusServiceUnavailable, `"code":"service_not_ready"`},
		{"storage unavailable", nil, errors.New("storage unavailable"), http.StatusServiceUnavailable, `"code":"service_not_ready"`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			checker := newChecker(
				time.Second,
				func(context.Context) error { return test.databaseErr },
				func() error { return test.storageErr },
			)
			response := performHealthRequest(checker.Readiness)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantResponse) {
				t.Fatalf("readiness response = %d %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("readiness Cache-Control = %q", response.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestReadinessStopsAcceptingTrafficDuringShutdown(t *testing.T) {
	checker := newChecker(time.Second, func(context.Context) error { return nil }, func() error { return nil })
	checker.MarkShuttingDown()
	response := performHealthRequest(checker.Readiness)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"service_shutting_down"`) {
		t.Fatalf("shutdown readiness response = %d %s", response.Code, response.Body.String())
	}
}

func TestReadinessAppliesDatabaseTimeout(t *testing.T) {
	checker := newChecker(
		10*time.Millisecond,
		func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
		func() error { return nil },
	)
	started := time.Now()
	response := performHealthRequest(checker.Readiness)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("timed-out readiness status = %d", response.Code)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("readiness timeout took %s", elapsed)
	}
}

func TestWritableDirectoryProbe(t *testing.T) {
	directory := t.TempDir()
	if err := checkWritableDirectory(directory); err != nil {
		t.Fatalf("writable directory check failed: %v", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read probe directory: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != ".health" || !entries[0].IsDir() {
		t.Fatalf("readiness probe left unexpected content behind: %v", entries)
	}
	probeEntries, err := os.ReadDir(filepath.Join(directory, ".health"))
	if err != nil {
		t.Fatalf("read health directory: %v", err)
	}
	if len(probeEntries) != 0 {
		t.Fatalf("readiness probe left files behind: %v", probeEntries)
	}

	file := filepath.Join(directory, "file")
	if err := os.WriteFile(file, []byte("content"), 0o600); err != nil {
		t.Fatalf("write file fixture: %v", err)
	}
	if err := checkWritableDirectory(file); err == nil {
		t.Fatal("file path passed the writable-directory check")
	}
}
