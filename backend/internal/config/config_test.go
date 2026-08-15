package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadFromEnvRejectsMissingOrWeakSecrets(t *testing.T) {
	tests := []struct {
		name        string
		dsn         string
		jwtSecret   string
		wantErrText string
	}{
		{
			name:        "missing database DSN",
			wantErrText: "DB_DSN is required",
		},
		{
			name:        "missing JWT secret",
			dsn:         "host=localhost dbname=unit_test",
			wantErrText: "JWT_SECRET is required",
		},
		{
			name:        "weak JWT secret",
			dsn:         "host=localhost dbname=unit_test",
			jwtSecret:   "too-short",
			wantErrText: "at least 32 bytes",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("DB_DSN", tt.dsn)
			t.Setenv("JWT_SECRET", tt.jwtSecret)

			_, err := LoadFromEnv()
			if err == nil || !strings.Contains(err.Error(), tt.wantErrText) {
				t.Fatalf("LoadFromEnv() error = %v, want error containing %q", err, tt.wantErrText)
			}
		})
	}
}

func TestLoadFromEnvAcceptsValidatedConfiguration(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("SERVER_ADDRESS", ":18080")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.ServerAddress != ":18080" {
		t.Fatalf("ServerAddress = %q, want %q", cfg.ServerAddress, ":18080")
	}
	if string(cfg.JWTSecret) != "12345678901234567890123456789012" {
		t.Fatal("JWTSecret was not loaded from the environment")
	}
	if cfg.Environment != "development" || cfg.CookieSecure {
		t.Fatalf("development security config = environment %q, secure %v", cfg.Environment, cfg.CookieSecure)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("default allowed origins = %v", cfg.AllowedOrigins)
	}
	if cfg.MaxUploadBytes != 10*1024*1024 {
		t.Fatalf("MaxUploadBytes = %d, want %d", cfg.MaxUploadBytes, 10*1024*1024)
	}
	if !strings.HasSuffix(cfg.UploadDir, "uploads") {
		t.Fatalf("UploadDir = %q, want an absolute uploads directory", cfg.UploadDir)
	}
}

func TestLoadFromEnvValidatesUploadLimit(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")

	for _, value := range []string{"0", "not-a-number", "104857601"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("MAX_UPLOAD_BYTES", value)
			if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "MAX_UPLOAD_BYTES") {
				t.Fatalf("MAX_UPLOAD_BYTES=%q error = %v", value, err)
			}
		})
	}

	t.Setenv("MAX_UPLOAD_BYTES", "2097152")
	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("valid upload limit error = %v", err)
	}
	if cfg.MaxUploadBytes != 2097152 {
		t.Fatalf("MaxUploadBytes = %d, want 2097152", cfg.MaxUploadBytes)
	}
}

func TestLoadFromEnvRejectsUnsafeUploadDirectory(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("UPLOAD_DIR", string(filepath.Separator))
	if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "filesystem root") {
		t.Fatalf("filesystem-root UPLOAD_DIR error = %v", err)
	}

	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, []byte("content"), 0o600); err != nil {
		t.Fatalf("write upload path fixture: %v", err)
	}
	t.Setenv("UPLOAD_DIR", file)
	if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "must be a directory") {
		t.Fatalf("file UPLOAD_DIR error = %v", err)
	}
}

func TestProductionRequiresExplicitSecureCookieOrigins(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("APP_ENV", "production")
	t.Setenv("ALLOWED_ORIGINS", "")

	if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "ALLOWED_ORIGINS") {
		t.Fatalf("missing production origins error = %v", err)
	}

	t.Setenv("ALLOWED_ORIGINS", "https://blog.example.com")
	t.Setenv("COOKIE_SECURE", "false")
	if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "COOKIE_SECURE") {
		t.Fatalf("insecure production cookie error = %v", err)
	}

	t.Setenv("COOKIE_SECURE", "true")
	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("valid production config error = %v", err)
	}
	if !cfg.CookieSecure || len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "https://blog.example.com" {
		t.Fatalf("production config = %+v", cfg)
	}
}

func TestLoadFromEnvRejectsInvalidOrigin(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("ALLOWED_ORIGINS", "*")

	if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "invalid allowed origin") {
		t.Fatalf("invalid origin error = %v", err)
	}
}
