package session

import (
	"net/http/httptest"
	"testing"

	"blog-backend/internal/config"
)

func loadSessionTestConfig(t *testing.T) {
	t.Helper()
	t.Setenv("DB_DSN", "host=localhost dbname=test sslmode=disable")
	t.Setenv("JWT_SECRET", "session-test-secret-that-is-at-least-32-bytes")
	t.Setenv("APP_ENV", "test")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("UPLOAD_DIR", t.TempDir())
	if _, err := config.LoadFromEnv(); err != nil {
		t.Fatalf("load test config: %v", err)
	}
}

func TestSessionCookieSupportsServerRenderedRoutesAndExpiresLegacyPath(t *testing.T) {
	loadSessionTestConfig(t)
	recorder := httptest.NewRecorder()

	SetCookie(recorder, "signed-session")

	var activeCookieFound, legacyCookieExpired bool
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name != CookieName {
			continue
		}
		if cookie.Path == cookiePath && cookie.Value == "signed-session" && cookie.HttpOnly {
			activeCookieFound = true
		}
		if cookie.Path == legacyPath && cookie.Value == "" && cookie.MaxAge < 0 {
			legacyCookieExpired = true
		}
	}
	if !activeCookieFound {
		t.Fatal("active session cookie was not scoped to the whole site")
	}
	if !legacyCookieExpired {
		t.Fatal("legacy /api session cookie was not expired")
	}
}

func TestClearCookiesExpiresCurrentAndLegacySessionPaths(t *testing.T) {
	loadSessionTestConfig(t)
	recorder := httptest.NewRecorder()

	ClearCookies(recorder)

	expiredPaths := map[string]bool{}
	csrfExpired := false
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == CookieName && cookie.Value == "" && cookie.MaxAge < 0 {
			expiredPaths[cookie.Path] = true
		}
		if cookie.Name == CSRFCookieName && cookie.Path == cookiePath && cookie.Value == "" && cookie.MaxAge < 0 {
			csrfExpired = true
		}
	}
	if !expiredPaths[cookiePath] || !expiredPaths[legacyPath] {
		t.Fatalf("expired session paths = %#v, want %q and %q", expiredPaths, cookiePath, legacyPath)
	}
	if !csrfExpired {
		t.Fatal("CSRF cookie was not expired")
	}
}
