package testutil

import (
	"strings"
	"testing"
)

func TestOpenDatabaseRejectsNonTestDatabase(t *testing.T) {
	t.Setenv(
		"TEST_DB_DSN",
		"host=localhost user=postgres password=unused dbname=blog_db port=5432 sslmode=disable",
	)

	_, err := OpenDatabase()
	if err == nil || !strings.Contains(err.Error(), "refusing to use non-test database") {
		t.Fatalf("OpenDatabase() error = %v, want non-test database rejection", err)
	}
}

func TestOpenDatabaseRequiresDSN(t *testing.T) {
	t.Setenv("TEST_DB_DSN", "")

	_, err := OpenDatabase()
	if err == nil || !strings.Contains(err.Error(), "TEST_DB_DSN is required") {
		t.Fatalf("OpenDatabase() error = %v, want missing DSN error", err)
	}
}
