package httpcache

import (
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	// PublicReadPolicy keeps browser copies deliberately short while allowing a
	// future shared proxy to absorb bursts of anonymous reads for up to a minute.
	PublicReadPolicy = "public, max-age=15, s-maxage=60, stale-while-revalidate=30"
	// PublicFilePolicy gives immutable file content a longer browser lifetime.
	// Revalidation remains available through ETag and Last-Modified.
	PublicFilePolicy = "public, max-age=300, stale-while-revalidate=60"
	NoStorePolicy    = "no-store"
)

// DefaultNoStore prevents authenticated, mutation, and error responses from
// being cached unless a public handler explicitly opts into a public policy.
func DefaultNoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", NoStorePolicy)
		c.Next()
	}
}

func PublicRead(c *gin.Context) {
	c.Header("Cache-Control", PublicReadPolicy)
}

func PublicFile(c *gin.Context) {
	c.Header("Cache-Control", PublicFilePolicy)
}

// WeakFileETag creates an opaque validator without exposing the storage key.
// It is weak because it is derived from file metadata rather than file bytes.
func WeakFileETag(storageKey string, size int64, modified time.Time) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d\x00%d", storageKey, size, modified.UnixNano())))
	return fmt.Sprintf("W/\"%x\"", digest[:16])
}
