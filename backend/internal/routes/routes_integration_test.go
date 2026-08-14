package routes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"blog-backend/internal/models"
	"blog-backend/internal/testutil"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type loginResponse struct {
	Token string `json:"token"`
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
	return user
}

func performJSONRequest(t *testing.T, router http.Handler, method, path string, body any, token string) *httptest.ResponseRecorder {
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
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func loginAs(t *testing.T, router http.Handler, username, password string) string {
	t.Helper()
	response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
		"username": username,
		"password": password,
	}, "")
	if response.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var result loginResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	if result.Token == "" {
		t.Fatal("login response did not include a token")
	}
	return result.Token
}

func signedToken(t *testing.T, secret string, expiresAt time.Time, role string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"username": "admin",
		"role":     role,
		"user_id":  1,
		"exp":      expiresAt.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func TestAuthenticationAndAdminAuthorization(t *testing.T) {
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "admin", "correct-password", "admin")
	createTestUser(t, db, "writer", "writer-password", "writer")
	router := SetupRouter()

	t.Run("valid administrator login", func(t *testing.T) {
		token := loginAs(t, router, "admin", "correct-password")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, token)
		if response.Code != http.StatusOK {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusOK)
		}
	})

	t.Run("wrong password", func(t *testing.T) {
		response := performJSONRequest(t, router, http.MethodPost, "/api/login", map[string]string{
			"username": "admin",
			"password": "wrong-password",
		}, "")
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("login status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("missing credentials", func(t *testing.T) {
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, "")
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("non-admin user", func(t *testing.T) {
		token := loginAs(t, router, "writer", "writer-password")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, token)
		if response.Code != http.StatusForbidden {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusForbidden)
		}
	})

	t.Run("expired token", func(t *testing.T) {
		token := signedToken(t, testutil.TestJWTSecret, time.Now().Add(-time.Hour), "admin")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, token)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong signature", func(t *testing.T) {
		token := signedToken(t, "a-different-test-secret-with-at-least-32-bytes", time.Now().Add(time.Hour), "admin")
		response := performJSONRequest(t, router, http.MethodGet, "/api/admin/me", nil, token)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("admin /me status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})
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
		{Title: "Published post", Slug: "published-post", Content: "Visible", CategoryID: category.ID, Status: "published", PublishedAt: &now},
		{Title: "Draft post", Slug: "draft-post", Content: "Hidden", CategoryID: category.ID, Status: "draft"},
	}
	if err := db.Create(&posts).Error; err != nil {
		t.Fatalf("create posts: %v", err)
	}

	router := SetupRouter()
	publicResponse := performJSONRequest(t, router, http.MethodGet, "/api/posts", nil, "")
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
	draftResponse := performJSONRequest(t, router, http.MethodGet, draftPath, nil, "")
	if draftResponse.Code != http.StatusNotFound {
		t.Fatalf("public draft detail status = %d, want %d", draftResponse.Code, http.StatusNotFound)
	}

	adminToken := loginAs(t, router, "admin", "correct-password")
	adminResponse := performJSONRequest(t, router, http.MethodGet, "/api/admin/posts", nil, adminToken)
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
