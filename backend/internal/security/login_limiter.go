package security

import (
	"strings"
	"sync"
	"time"
)

type loginAttempt struct {
	failures     int
	windowStart  time.Time
	blockedUntil time.Time
}

// LoginLimiter bounds password guessing by both source IP and the
// source-IP/username pair. Entries expire automatically after the window.
type LoginLimiter struct {
	mu          sync.Mutex
	attempts    map[string]loginAttempt
	maxFailures int
	window      time.Duration
	now         func() time.Time
	lastCleanup time.Time
}

func NewLoginLimiter(maxFailures int, window time.Duration) *LoginLimiter {
	return &LoginLimiter{
		attempts:    make(map[string]loginAttempt),
		maxFailures: maxFailures,
		window:      window,
		now:         time.Now,
	}
}

func (l *LoginLimiter) Allow(ip, username string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.cleanupExpired(now)
	for _, key := range limiterKeys(ip, username) {
		attempt, exists := l.attempts[key]
		if !exists {
			continue
		}
		if !attempt.blockedUntil.IsZero() && now.Before(attempt.blockedUntil) {
			return false, attempt.blockedUntil.Sub(now)
		}
		if now.Sub(attempt.windowStart) >= l.window {
			delete(l.attempts, key)
		}
	}
	return true, 0
}

func (l *LoginLimiter) RecordFailure(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.cleanupExpired(now)
	for _, key := range limiterKeys(ip, username) {
		attempt := l.attempts[key]
		if attempt.windowStart.IsZero() || now.Sub(attempt.windowStart) >= l.window {
			attempt = loginAttempt{windowStart: now}
		}
		attempt.failures++
		if attempt.failures >= l.maxFailures {
			attempt.blockedUntil = attempt.windowStart.Add(l.window)
		}
		l.attempts[key] = attempt
	}
}

func (l *LoginLimiter) cleanupExpired(now time.Time) {
	if !l.lastCleanup.IsZero() && now.Sub(l.lastCleanup) < time.Minute {
		return
	}
	for key, attempt := range l.attempts {
		if now.Sub(attempt.windowStart) >= l.window && (attempt.blockedUntil.IsZero() || !now.Before(attempt.blockedUntil)) {
			delete(l.attempts, key)
		}
	}
	l.lastCleanup = now
}

func (l *LoginLimiter) Reset(ip, username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range limiterKeys(ip, username) {
		delete(l.attempts, key)
	}
}

func limiterKeys(ip, username string) []string {
	ip = strings.TrimSpace(ip)
	username = strings.ToLower(strings.TrimSpace(username))
	return []string{"ip:" + ip, "pair:" + ip + ":" + username}
}
