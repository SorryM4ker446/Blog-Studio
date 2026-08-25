package observability

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestProductionLoggerRedactsSensitiveAttributes(t *testing.T) {
	var output bytes.Buffer
	logger := NewLogger("production", &output)
	logger.Info(
		"configuration loaded",
		"JWT_SECRET", "do-not-log",
		"database_dsn", "do-not-log-either",
		"component", "backend",
	)

	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode structured log: %v; output=%s", err, output.String())
	}
	if record["JWT_SECRET"] != "[REDACTED]" || record["database_dsn"] != "[REDACTED]" {
		t.Fatalf("sensitive attributes were not redacted: %v", record)
	}
	if record["component"] != "backend" {
		t.Fatalf("ordinary attribute = %v, want backend", record["component"])
	}
}

func TestRequestMiddlewareValidatesRequestIDAndOmitsQueryFromLogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var output bytes.Buffer
	logger := NewLogger("production", &output)
	router := gin.New()
	if err := router.SetTrustedProxies(nil); err != nil {
		t.Fatalf("disable trusted proxies: %v", err)
	}
	router.Use(RequestMiddleware(logger), RecoveryMiddleware())
	router.GET("/resource/:id", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/resource/42?q=sensitive-search", nil)
	request.Header.Set(RequestIDHeader, "invalid request id")
	request.Header.Set("X-Forwarded-For", "203.0.113.25")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	requestID := response.Header().Get(RequestIDHeader)
	if !requestIDPattern.MatchString(requestID) || requestID == "invalid request id" {
		t.Fatalf("response request ID = %q", requestID)
	}
	logOutput := output.String()
	if !strings.Contains(logOutput, `"route":"/resource/:id"`) || !strings.Contains(logOutput, `"client_ip":"192.0.2.1"`) ||
		strings.Contains(logOutput, "sensitive-search") || strings.Contains(logOutput, "203.0.113.25") {
		t.Fatalf("access log did not use the route template or exposed the query: %s", logOutput)
	}
}

func TestRequestMiddlewarePreservesValidRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := router.SetTrustedProxies(nil); err != nil {
		t.Fatalf("disable trusted proxies: %v", err)
	}
	router.Use(RequestMiddleware(slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))))
	router.GET("/", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(RequestIDHeader, "proxy-request-123")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Header().Get(RequestIDHeader) != "proxy-request-123" {
		t.Fatalf("response request ID = %q", response.Header().Get(RequestIDHeader))
	}
}

func TestRecoveryMiddlewareReturnsGenericStructuredError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var output bytes.Buffer
	router := gin.New()
	if err := router.SetTrustedProxies(nil); err != nil {
		t.Fatalf("disable trusted proxies: %v", err)
	}
	router.Use(RequestMiddleware(NewLogger("production", &output)), RecoveryMiddleware())
	router.GET("/panic", func(_ *gin.Context) { panic("private panic detail") })

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/panic", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("panic response status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"code":"internal_error"`) || strings.Contains(response.Body.String(), "private panic detail") {
		t.Fatalf("panic response body = %s", response.Body.String())
	}
	if strings.Contains(output.String(), "private panic detail") {
		t.Fatalf("panic log exposed the recovered value: %s", output.String())
	}
}
