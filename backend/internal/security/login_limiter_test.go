package security

import (
	"testing"
	"time"
)

func TestLoginLimiterBlocksAndExpires(t *testing.T) {
	now := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)
	limiter := NewLoginLimiter(3, 10*time.Minute)
	limiter.now = func() time.Time { return now }

	for attempt := 0; attempt < 3; attempt++ {
		if allowed, _ := limiter.Allow("192.0.2.1", "admin"); !allowed {
			t.Fatalf("attempt %d was blocked too early", attempt+1)
		}
		limiter.RecordFailure("192.0.2.1", "admin")
	}
	if allowed, retry := limiter.Allow("192.0.2.1", "admin"); allowed || retry <= 0 {
		t.Fatalf("blocked attempt = allowed %v, retry %v", allowed, retry)
	}

	now = now.Add(11 * time.Minute)
	if allowed, _ := limiter.Allow("192.0.2.1", "admin"); !allowed {
		t.Fatal("attempt remained blocked after the window expired")
	}
}

func TestLoginLimiterReset(t *testing.T) {
	limiter := NewLoginLimiter(1, time.Hour)
	limiter.RecordFailure("192.0.2.1", "admin")
	limiter.Reset("192.0.2.1", "admin")
	if allowed, _ := limiter.Allow("192.0.2.1", "admin"); !allowed {
		t.Fatal("successful login did not reset limiter")
	}
}
