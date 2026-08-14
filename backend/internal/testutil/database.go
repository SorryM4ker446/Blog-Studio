package testutil

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"blog-backend/internal/config"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const TestJWTSecret = "blog-studio-test-jwt-secret-only-32-bytes-minimum"

// OpenDatabase connects only when TEST_DB_DSN names a database ending in
// "_test". This guard prevents automated tests from mutating development or
// production data even when an environment variable is misconfigured.
func OpenDatabase() (*gorm.DB, error) {
	dsn := strings.TrimSpace(os.Getenv("TEST_DB_DSN"))
	if dsn == "" {
		return nil, errors.New("TEST_DB_DSN is required for integration tests")
	}

	parsed, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse TEST_DB_DSN: %w", err)
	}
	if !strings.HasSuffix(strings.ToLower(parsed.Database), "_test") {
		return nil, fmt.Errorf("refusing to use non-test database %q", parsed.Database)
	}

	if err := os.Setenv("DB_DSN", dsn); err != nil {
		return nil, fmt.Errorf("set test DB_DSN: %w", err)
	}
	if err := os.Setenv("JWT_SECRET", TestJWTSecret); err != nil {
		return nil, fmt.Errorf("set test JWT_SECRET: %w", err)
	}
	if err := os.Setenv("APP_ENV", "test"); err != nil {
		return nil, fmt.Errorf("set test APP_ENV: %w", err)
	}
	if err := os.Setenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3100"); err != nil {
		return nil, fmt.Errorf("set test ALLOWED_ORIGINS: %w", err)
	}
	if err := os.Setenv("COOKIE_SECURE", "false"); err != nil {
		return nil, fmt.Errorf("set test COOKIE_SECURE: %w", err)
	}
	if _, err := config.LoadFromEnv(); err != nil {
		return nil, fmt.Errorf("load test configuration: %w", err)
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("connect to test database: %w", err)
	}

	if err := config.Migrate(db); err != nil {
		return nil, fmt.Errorf("migrate test database: %w", err)
	}

	config.DB = db
	return db, nil
}

// ResetDatabase removes only test data. OpenDatabase must have validated the
// database name before this function is called.
func ResetDatabase(db *gorm.DB) error {
	return db.Exec(
		"TRUNCATE TABLE settings, files, posts, categories, users RESTART IDENTITY CASCADE",
	).Error
}
