package httpcache

import (
	"strings"
	"testing"
	"time"
)

func TestWeakFileETagIsOpaqueAndStable(t *testing.T) {
	modified := time.Date(2026, time.August, 26, 10, 30, 0, 0, time.UTC)
	first := WeakFileETag("private-storage-key.png", 42, modified)
	second := WeakFileETag("private-storage-key.png", 42, modified)
	changed := WeakFileETag("private-storage-key.png", 43, modified)

	if first != second {
		t.Fatalf("stable metadata produced different ETags: %q and %q", first, second)
	}
	if first == changed {
		t.Fatalf("different file metadata produced the same ETag %q", first)
	}
	if first == "" || strings.Contains(first, "private-storage-key") {
		t.Fatalf("ETag is empty or exposes the storage key: %q", first)
	}
}
