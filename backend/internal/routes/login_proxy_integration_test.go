package routes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLoginRateLimitUsesTrustedClientAddress(t *testing.T) {
	sequence := loginRateLimitTestSequence.Add(1)
	addresses := map[string]string{}
	// Preserve address families and identity relationships without reusing limiter keys.
	isolate := func(value string) string {
		parts := strings.Split(value, ",")
		for i, part := range parts {
			original := strings.TrimSpace(part)
			ip := net.ParseIP(original)
			if ip == nil {
				continue
			}
			if _, exists := addresses[original]; !exists {
				if ip.To4() != nil {
					addresses[original] = fmt.Sprintf("198.18.%d.%d", sequence, len(addresses)+1)
				} else {
					addresses[original] = fmt.Sprintf("2001:db8:%x::%x", sequence, len(addresses)+1)
				}
			}
			parts[i] = addresses[original]
		}
		return strings.Join(parts, ", ")
	}
	t.Setenv("TRUSTED_PROXIES", isolate("172.30.0.2,fd00::2"))
	db := requireTestDatabase(t)
	gin.SetMode(gin.TestMode)
	createTestUser(t, db, "proxy-admin", "correct-password", "admin")
	router := SetupRouter()
	auth := csrfAuth(t, router, "192.0.2.200")
	login := func(peer, forwarded, realIP, username, password string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]string{"username": username, "password": password})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(body))
		req.RemoteAddr = net.JoinHostPort(isolate(peer), "1234")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-CSRF-Token", auth.csrfToken)
		req.Header.Set("X-Forwarded-For", isolate(forwarded))
		req.Header.Set("X-Real-IP", isolate(realIP))
		for _, cookie := range auth.cookies {
			req.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}

	for _, tc := range []struct{ name, peer, client, other string }{
		{"IPv4 proxy", "172.30.0.2", "203.0.113.10", "203.0.113.11"},
		{"IPv6 proxy", "fd00::2", "2001:db8::10", "2001:db8::11"},
		{"trusted multi-hop chain", "172.30.0.2", "203.0.113.20, fd00::2", "203.0.113.21, fd00::2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for attempt := 0; attempt < 5; attempt++ {
				if response := login(tc.peer, tc.client, "", "proxy-admin", "wrong-password"); response.Code != http.StatusUnauthorized {
					t.Fatalf("failure %d status = %d", attempt, response.Code)
				}
			}
			blocked := login(tc.peer, tc.client, "", "different-username", "correct-password")
			if blocked.Code != http.StatusTooManyRequests || blocked.Header().Get("Retry-After") == "" {
				t.Fatalf("blocked status = %d, Retry-After = %q", blocked.Code, blocked.Header().Get("Retry-After"))
			}
			if response := login(tc.peer, tc.other, "", "proxy-admin", "correct-password"); response.Code != http.StatusOK {
				t.Fatalf("independent client's login status = %d", response.Code)
			}
			if response := login(tc.peer, tc.client, "", "proxy-admin", "correct-password"); response.Code != http.StatusTooManyRequests {
				t.Fatalf("another client's success reset blocked client's budget: %d", response.Code)
			}
		})
	}

	t.Run("untrusted caller cannot rotate forwarded identities", func(t *testing.T) {
		for attempt := 0; attempt < 5; attempt++ {
			if response := login("198.51.100.80", "203.0.113.80", "203.0.113.81", "proxy-admin", "wrong-password"); response.Code != http.StatusUnauthorized {
				t.Fatalf("failure status = %d", response.Code)
			}
		}
		if response := login("198.51.100.80", "203.0.113.82", "203.0.113.83", "proxy-admin", "correct-password"); response.Code != http.StatusTooManyRequests {
			t.Fatalf("spoofed status = %d", response.Code)
		}
		if response := login("198.51.100.81", "203.0.113.80", "203.0.113.81", "proxy-admin", "correct-password"); response.Code != http.StatusOK {
			t.Fatalf("independent direct client status = %d", response.Code)
		}
	})

	t.Run("missing or malformed forwarding falls back to peer", func(t *testing.T) {
		for attempt := 0; attempt < 5; attempt++ {
			if response := login("fd00::2", "invalid-address", "", "proxy-admin", "wrong-password"); response.Code != http.StatusUnauthorized {
				t.Fatalf("failure status = %d", response.Code)
			}
		}
		if response := login("fd00::2", "", "", "proxy-admin", "correct-password"); response.Code != http.StatusTooManyRequests {
			t.Fatalf("fallback status = %d", response.Code)
		}
		if response := login("fd00::2", "2001:db8::90", "", "proxy-admin", "correct-password"); response.Code != http.StatusOK {
			t.Fatalf("valid forwarded client status = %d", response.Code)
		}
	})

	t.Run("success resets resolved client failures", func(t *testing.T) {
		for cycle := 0; cycle < 2; cycle++ {
			for attempt := 0; attempt < 4; attempt++ {
				if response := login("172.30.0.2", "203.0.113.99", "", "proxy-admin", "wrong-password"); response.Code != http.StatusUnauthorized {
					t.Fatalf("failure after reset status = %d", response.Code)
				}
			}
			if response := login("172.30.0.2", "203.0.113.99", "", "proxy-admin", "correct-password"); response.Code != http.StatusOK {
				t.Fatalf("success status = %d", response.Code)
			}
		}
	})
}
