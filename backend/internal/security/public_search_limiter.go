package security

import (
	"strings"
	"sync"
	"time"
)

const publicSearchEntryTTL = 10 * time.Minute

type publicSearchBucket struct {
	tokens   float64
	updated  time.Time
	lastSeen time.Time
}

// PublicSearchLimiter is an in-process token bucket intended for a single API
// instance. It protects the database from anonymous search bursts without
// introducing shared infrastructure into the single-host deployment baseline.
type PublicSearchLimiter struct {
	mu              sync.Mutex
	buckets         map[string]publicSearchBucket
	refillPerSecond float64
	burst           float64
	now             func() time.Time
	lastCleanup     time.Time
}

func NewPublicSearchLimiter(ratePerMinute, burst int) *PublicSearchLimiter {
	return &PublicSearchLimiter{
		buckets:         make(map[string]publicSearchBucket),
		refillPerSecond: float64(ratePerMinute) / 60,
		burst:           float64(burst),
		now:             time.Now,
	}
}

func (l *PublicSearchLimiter) Allow(clientIP string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.cleanupExpired(now)
	key := strings.TrimSpace(clientIP)
	bucket, exists := l.buckets[key]
	if !exists {
		bucket = publicSearchBucket{tokens: l.burst, updated: now}
	} else if elapsed := now.Sub(bucket.updated).Seconds(); elapsed > 0 {
		bucket.tokens = min(l.burst, bucket.tokens+elapsed*l.refillPerSecond)
		bucket.updated = now
	}
	bucket.lastSeen = now

	if bucket.tokens >= 1 {
		bucket.tokens--
		l.buckets[key] = bucket
		return true, 0
	}

	l.buckets[key] = bucket
	retryAfter := time.Duration((1 - bucket.tokens) / l.refillPerSecond * float64(time.Second))
	if retryAfter < time.Millisecond {
		retryAfter = time.Millisecond
	}
	return false, retryAfter
}

func (l *PublicSearchLimiter) cleanupExpired(now time.Time) {
	if !l.lastCleanup.IsZero() && now.Sub(l.lastCleanup) < time.Minute {
		return
	}
	for key, bucket := range l.buckets {
		if now.Sub(bucket.lastSeen) >= publicSearchEntryTTL {
			delete(l.buckets, key)
		}
	}
	l.lastCleanup = now
}
