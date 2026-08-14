package routes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"blog-backend/internal/models"
	"blog-backend/internal/session"
	"blog-backend/internal/testutil"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type requestAuth struct {
	cookies   []*http.Cookie
	csrfToken string
	remoteIP  string
}

type loginResponse struct {
	CSRFToken string `json:"csrf_token"`
}

func requireTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("TEST_DB_DSN") == "" {
		t.Skip("TEST_DB_DSN is not configured; skipping PostgreSQL integration test")
	}

	db, err := testutil.OpenDatabase()
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := testutil.ResetDatabase(db); err != nil {
		t.Fatalf("reset test database: %v", err)
	}
	t.Cleanup(func() {
		if err := testutil.ResetDatabase(db); err != nil {
			t.Errorf("cleanup test database: %v", err)
		}
	})
	return db
}

func createTestUser(t *testing.T, db *gorm.DB, username, password, role string) models.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := models.User{Username: username, PasswordHash: string(hash), Role: role}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	if err := db.First(&user, user.ID).Error; err != nil {
		t.Fatalf("reload test user: %v", err)
	}
	return user
}

func performJSONRequest(t *testing.T, router http.Handler, method, path string, body any, auth *requestAuth, includeCSRF bool) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}

	req := httptest.NewRequest(method, path, &payload)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth != nil {
		for _, cookie := range auth.cookies {
			req.AddCookie(cookie)
		}
		if includeCSRF {
			req.Header.Set("X-CSRF-Token", auth.csrfToken)
		}
		if auth.remoteIP != "" {
			req.RemoteAddr = auth.remoteIP + ":1234"
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func csrfAuth(t *testing.T, router http.Handler, remoteIP string) *requestAuth {
	t.Helper()
	response := performJSONRequest(t, router, http.MethodGet, "/api/csrf", nil, &requestAuth{remoteIP: remoteIP}, false)
	if response.Code != http.StatusOK {
		t.Fatalf("csrf status = %d, want %d", response.Code, http.StatusOK)
	}
	var result loginResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode csrf response: %v", err)
	}
	return &requestAuth{cookies: response.Result().Cookies(), csrfToken: result.CSRFToken, remoteIP: remoteIP}
}

func loginAs(t *testing.T, router http.Handler, username, password string) *requestAuth {
	t.Helper()
	auth := csrfAuth(t, router, "192.0.2.1")
	response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
		"username": username,
		"password": password,
	}, auth, true)
	if response.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var result loginResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if result.CSRFToken == "" {
		t.Fatal("login response did not include a CSRF token")
	}
	return &requestAuth{cookies: response.Result().Cookies(), csrfToken: result.CSRFToken, remoteIP: auth.remoteIP}
}

func signedToken(t *testing.T, user models.User, secret string, expiresAt time.Time, method jwt.SigningMethod) string {
	t.Helper()
	now := time.Now().Add(-time.Minute)
	claims := jwt.MapClaims{
		"username":        user.Username,
		"role":            user.Role,
		"user_id":         user.ID,
		"session_version": user.SessionVersion,
		"iss":             "blog-studio",
		"sub":             strconv.FormatUint(uint64(user.ID), 10),
		"iat":             now.Unix(),
		"nbf":             now.Unix(),
		"exp":             expiresAt.Unix(),
		"jti":             "integration-test-token",
	}
	token := jwt.NewWithClaims(method, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func cookieAuth(token string) *requestAuth {
	return &requestAuth{cookies: []*http.Cookie{{Name: session.CookieName, Value: token, Path: "/api"}}}
}

func TestAuthenticationAndAdminAuthorization(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	admin := createTestUser(t, db, "admin", "correct-password", "admin")
	createTestUser(t, db, "writer", "writer-password", "writer")
	router := SetupRouter()

	t.Run("valid administrator login", func(t *testing.T) {
		auth := loginAs(t, router, "admin", "correct-password")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, auth, false)
		if response.Code != http.StatusOK {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusOK)
		}
	})

	t.Run("wrong password", func(t *testing.T) {
		auth := csrfAuth(t, router, "192.0.2.10")
		response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
			"username": "admin",
			"password": "wrong-password",
		}, auth, true)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("login status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("missing session", func(t *testing.T) {
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, nil, false)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("non-admin user", func(t *testing.T) {
		auth := loginAs(t, router, "writer", "writer-password")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, auth, false)
		if response.Code != http.StatusForbidden {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusForbidden)
		}
	})

	t.Run("expired token", func(t *testing.T) {
		token := signedToken(t, admin, testutil.TestJWTSecret, time.Now().Add(-time.Hour), jwt.SigningMethodHS256)
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, cookieAuth(token), false)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong signature", func(t *testing.T) {
		token := signedToken(t, admin, "a-different-test-secret-with-at-least-32-bytes", time.Now().Add(time.Hour), jwt.SigningMethodHS256)
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, cookieAuth(token), false)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("unexpected signing algorithm", func(t *testing.T) {
		token := signedToken(t, admin, testutil.TestJWTSecret, time.Now().Add(time.Hour), jwt.SigningMethodHS384)
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, cookieAuth(token), false)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})
}

func TestSessionCSRFAndPasswordSecurity(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "admin", "correct-password", "admin")
	router := SetupRouter()

	t.Run("write without csrf is rejected", func(t *testing.T) {
		auth := loginAs(t, router, "admin", "correct-password")
		response := performJSONRequest(t, router, http.MethodPost, "/api/admin/categories", map[string]string{"name": "Blocked"}, auth, false)
		if response.Code != http.StatusForbidden {
			t.Fatalf("category status = %d, want %d", response.Code, http.StatusForbidden)
		}
	})

	t.Run("weak password is rejected", func(t *testing.T) {
		auth := loginAs(t, router, "admin", "correct-password")
		response := performJSONRequest(t, router, http.MethodPut, "/api/admin/password", map[string]string{
			"current_password": "correct-password",
			"new_password":     "short",
		}, auth, true)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("password status = %d, want %d", response.Code, http.StatusBadRequest)
		}
	})

	t.Run("logout invalidates copied session", func(t *testing.T) {
		auth := loginAs(t, router, "admin", "correct-password")
		response := performJSONRequest(t, router, http.MethodPost, "/api/admin/logout", nil, auth, true)
		if response.Code != http.StatusOK {
			t.Fatalf("logout status = %d, want %d", response.Code, http.StatusOK)
		}
		response = performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, auth, false)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("copied session status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})
}

func TestLoginRateLimit(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "rate-user", "correct-password", "admin")
	router := SetupRouter()
	auth := csrfAuth(t, router, "198.51.100.25")

	for attempt := 1; attempt <= 5; attempt++ {
		response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
			"username": "rate-user",
			"password": "wrong-password",
		}, auth, true)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want %d", attempt, response.Code, http.StatusUnauthorized)
		}
	}
	response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
		"username": "rate-user",
		"password": "correct-password",
	}, auth, true)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" {
		t.Fatalf("limited status = %d, Retry-After = %q", response.Code, response.Header().Get("Retry-After"))
	}
}

func TestPasswordChangeInvalidatesCopiedSession(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "password-user", "current-password-123", "admin")
	router := SetupRouter()
	auth := loginAs(t, router, "password-user", "current-password-123")

	response := performJSONRequest(t, router, http.MethodPut, "/api/admin/password", map[string]string{
		"current_password": "current-password-123",
		"new_password":     "new-secure-passphrase-456",
	}, auth, true)
	if response.Code != http.StatusOK {
		t.Fatalf("password status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	response = performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, auth, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("copied session status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	loginAs(t, router, "password-user", "new-secure-passphrase-456")
}

func TestCORSAllowsOnlyConfiguredOrigins(t *testing.T) {
	requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	router := SetupRouter()

	allowed := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	allowed.Header.Set("Origin", "http://localhost:3000")
	allowedResponse := httptest.NewRecorder()
	router.ServeHTTP(allowedResponse, allowed)
	if allowedResponse.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" || allowedResponse.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("allowed CORS headers = %v", allowedResponse.Header())
	}

	blocked := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	blocked.Header.Set("Origin", "https://evil.example")
	blockedResponse := httptest.NewRecorder()
	router.ServeHTTP(blockedResponse, blocked)
	if blockedResponse.Code != http.StatusForbidden {
		t.Fatalf("blocked origin status = %d, want %d", blockedResponse.Code, http.StatusForbidden)
	}
}

func TestDraftVisibilityIsSeparatedFromPublicPosts(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "admin", "correct-password", "admin")

	category := models.Category{Name: "Test category"}
	if err := db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	now := time.Now()
	posts := []models.Post{
		{Title: "Published post", Slug: "published-post", Content: "Visible", CategoryID: &category.ID, Status: "published", PublishedAt: &now},
		{Title: "Draft post", Slug: "draft-post", Content: "Hidden", CategoryID: &category.ID, Status: "draft"},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("create posts: %v", err)
	}

	router := SetupRouter()
	publicResponse := performJSONRequest(t, router, http.MethodGet, "/api/posts", nil, nil, false)
	if publicResponse.Code != http.StatusOK {
		t.Fatalf("public posts status = %d, want %d", publicResponse.Code, http.StatusOK)
	}
	var publicResult struct {
		Data  []models.Post `json:"data"`
		Total int64         `json:"total"`
	}
	if err := json.Unmarshal(publicResponse.Body.Bytes(), &publicResult); err != nil {
		t.Fatalf("decode public posts: %v", err)
	}
	if publicResult.Total != 1 || len(publicResult.Data) != 1 || publicResult.Data[0].Status != "published" {
		t.Fatalf("public posts = %+v, want only the published post", publicResult.Data)
	}

	draftPath := fmt.Sprintf("/api/posts/%d", posts[1].ID)
	draftResponse := performJSONRequest(t, router, http.MethodGet, draftPath, nil, nil, false)
	if draftResponse.Code != http.StatusNotFound {
		t.Fatalf("public draft detail status = %d, want %d", draftResponse.Code, http.StatusNotFound)
	}

	auth := loginAs(t, router, "admin", "correct-password")
	adminResponse := performJSONRequest(t, router, http.MethodGet, "/api/admin/posts", nil, auth, false)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("admin posts status = %d, want %d", adminResponse.Code, http.StatusOK)
	}
	var adminResult struct {
		Data  []models.Post `json:"data"`
		Total int64         `json:"total"`
	}
	if err := json.Unmarshal(adminResponse.Body.Bytes(), &adminResult); err != nil {
		t.Fatalf("decode admin posts: %v", err)
	}
	if adminResult.Total != 2 || len(adminResult.Data) != 2 {
		t.Fatalf("admin post total = %d, data length = %d; want 2", adminResult.Total, len(adminResult.Data))
	}
}
