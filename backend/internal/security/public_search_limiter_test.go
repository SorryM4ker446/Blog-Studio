package security

import (
	"testing"
	"time"
)

func TestPublicSearchLimiterAllowsBurstAndRefills(t *testing.T) {
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	limiter := NewPublicSearchLimiter(60, 2)
	limiter.now = func() time.Time { return now }

	for attempt := 1; attempt <= 2; attempt++ {
		if allowed, retry := limiter.Allow("192.0.2.10"); !allowed || retry != 0 {
			t.Fatalf("burst attempt %d = allowed %v retry %s", attempt, allowed, retry)
		}
	}
	if allowed, retry := limiter.Allow("192.0.2.10"); allowed || retry < 900*time.Millisecond || retry > time.Second {
		t.Fatalf("limited attempt = allowed %v retry %s", allowed, retry)
	}

	now = now.Add(time.Second)
	if allowed, retry := limiter.Allow("192.0.2.10"); !allowed || retry != 0 {
		t.Fatalf("refilled attempt = allowed %v retry %s", allowed, retry)
	}
}

func TestPublicSearchLimiterSeparatesClients(t *testing.T) {
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	limiter := NewPublicSearchLimiter(60, 1)
	limiter.now = func() time.Time { return now }

	if allowed, _ := limiter.Allow("192.0.2.20"); !allowed {
		t.Fatal("first client was unexpectedly limited")
	}
	if allowed, _ := limiter.Allow("192.0.2.20"); allowed {
		t.Fatal("first client exceeded its burst without being limited")
	}
	if allowed, _ := limiter.Allow("192.0.2.21"); !allowed {
		t.Fatal("second client shared the first client's bucket")
	}
}
