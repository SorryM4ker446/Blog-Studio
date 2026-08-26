package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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
	if cfg.DBMaxOpenConnections != 10 || cfg.DBMaxIdleConnections != 5 {
		t.Fatalf("database pool defaults = open %d idle %d", cfg.DBMaxOpenConnections, cfg.DBMaxIdleConnections)
	}
	if cfg.HTTPReadHeaderTimeout != 5*time.Second || cfg.HTTPShutdownTimeout != 20*time.Second {
		t.Fatalf("HTTP timeout defaults = header %s shutdown %s", cfg.HTTPReadHeaderTimeout, cfg.HTTPShutdownTimeout)
	}
	if len(cfg.TrustedProxies) != 0 {
		t.Fatalf("TrustedProxies = %v, want none by default", cfg.TrustedProxies)
	}
}

func TestLoadFromEnvReadsMountedSecretsAndDatabaseFields(t *testing.T) {
	secretDir := t.TempDir()
	databasePasswordFile := filepath.Join(secretDir, "database-password")
	jwtSecretFile := filepath.Join(secretDir, "jwt-secret")
	if err := os.WriteFile(databasePasswordFile, []byte("password with symbols/+\n"), 0o600); err != nil {
		t.Fatalf("write database password fixture: %v", err)
	}
	if err := os.WriteFile(jwtSecretFile, []byte("12345678901234567890123456789012\n"), 0o600); err != nil {
		t.Fatalf("write JWT secret fixture: %v", err)
	}

	t.Setenv("DB_DSN", "")
	t.Setenv("DB_HOST", "postgres")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_USER", "blog_app")
	t.Setenv("DB_NAME", "blog_studio")
	t.Setenv("DB_PASSWORD_FILE", databasePasswordFile)
	t.Setenv("DB_SSLMODE", "disable")
	t.Setenv("DB_TIMEZONE", "Asia/Shanghai")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("JWT_SECRET_FILE", jwtSecretFile)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	parsed, err := pgx.ParseConfig(cfg.DatabaseDSN)
	if err != nil {
		t.Fatalf("parse assembled database URL: %v", err)
	}
	if parsed.Host != "postgres" || parsed.Port != 5433 || parsed.User != "blog_app" ||
		parsed.Database != "blog_studio" || parsed.Password != "password with symbols/+" {
		t.Fatalf("assembled database configuration was not preserved")
	}
	if parsed.RuntimeParams["timezone"] != "Asia/Shanghai" || parsed.TLSConfig != nil {
		t.Fatalf("database runtime parameters = %#v, TLS configured = %v", parsed.RuntimeParams, parsed.TLSConfig != nil)
	}
	if string(cfg.JWTSecret) != "12345678901234567890123456789012" {
		t.Fatal("JWT secret was not read from JWT_SECRET_FILE")
	}
}

func TestReadEnvironmentValueRejectsAmbiguousAndUnsafeFiles(t *testing.T) {
	secretFile := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secretFile, []byte("file-value\n"), 0o600); err != nil {
		t.Fatalf("write secret fixture: %v", err)
	}
	t.Setenv("EXAMPLE_SECRET", "direct-value")
	t.Setenv("EXAMPLE_SECRET_FILE", secretFile)
	if _, err := ReadEnvironmentValue("EXAMPLE_SECRET"); err == nil || !strings.Contains(err.Error(), "must not both be set") {
		t.Fatalf("ambiguous secret error = %v", err)
	}

	t.Setenv("EXAMPLE_SECRET", "")
	value, err := ReadEnvironmentValue("EXAMPLE_SECRET")
	if err != nil || value != "file-value" {
		t.Fatalf("file secret = %q, error = %v", value, err)
	}

	t.Setenv("EXAMPLE_SECRET_FILE", t.TempDir())
	if _, err := ReadEnvironmentValue("EXAMPLE_SECRET"); err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("directory secret error = %v", err)
	}
}

func TestLoadFromEnvValidatesOperationalConfiguration(t *testing.T) {
	t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
	t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("TRUSTED_PROXIES", "127.0.0.1, 10.20.0.0/16,127.0.0.1")
	t.Setenv("DB_MAX_OPEN_CONNECTIONS", "12")
	t.Setenv("DB_MAX_IDLE_CONNECTIONS", "4")
	t.Setenv("DB_CONNECTION_MAX_LIFETIME", "45m")
	t.Setenv("DB_CONNECTION_MAX_IDLE_TIME", "3m")
	t.Setenv("HTTP_READ_HEADER_TIMEOUT", "7s")
	t.Setenv("HTTP_READ_TIMEOUT", "90s")
	t.Setenv("HTTP_WRITE_TIMEOUT", "4m")
	t.Setenv("HTTP_IDLE_TIMEOUT", "75s")
	t.Setenv("HTTP_SHUTDOWN_TIMEOUT", "25s")
	t.Setenv("HEALTH_CHECK_TIMEOUT", "1500ms")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if len(cfg.TrustedProxies) != 2 || cfg.TrustedProxies[0] != "127.0.0.1" || cfg.TrustedProxies[1] != "10.20.0.0/16" {
		t.Fatalf("TrustedProxies = %v", cfg.TrustedProxies)
	}
	if cfg.DBMaxOpenConnections != 12 || cfg.DBMaxIdleConnections != 4 {
		t.Fatalf("database pool = open %d idle %d", cfg.DBMaxOpenConnections, cfg.DBMaxIdleConnections)
	}
	if cfg.DBConnectionLifetime != 45*time.Minute || cfg.DBConnectionIdleTime != 3*time.Minute {
		t.Fatalf("database durations = lifetime %s idle %s", cfg.DBConnectionLifetime, cfg.DBConnectionIdleTime)
	}
	if cfg.HTTPReadHeaderTimeout != 7*time.Second || cfg.HTTPReadTimeout != 90*time.Second ||
		cfg.HTTPWriteTimeout != 4*time.Minute || cfg.HTTPIdleTimeout != 75*time.Second ||
		cfg.HTTPShutdownTimeout != 25*time.Second || cfg.HealthCheckTimeout != 1500*time.Millisecond {
		t.Fatalf("operational timeouts were not loaded: %+v", cfg)
	}
}

func TestLoadFromEnvRejectsInvalidOperationalConfiguration(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{"TRUSTED_PROXIES", "not-a-network"},
		{"DB_MAX_OPEN_CONNECTIONS", "0"},
		{"DB_CONNECTION_MAX_LIFETIME", "0s"},
		{"HTTP_READ_HEADER_TIMEOUT", "31m"},
		{"HTTP_SHUTDOWN_TIMEOUT", "invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
			t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
			t.Setenv(test.name, test.value)
			if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), test.name) {
				t.Fatalf("%s=%q error = %v", test.name, test.value, err)
			}
		})
	}

	t.Run("idle connections exceed open connections", func(t *testing.T) {
		t.Setenv("DB_DSN", "host=localhost dbname=unit_test")
		t.Setenv("JWT_SECRET", "12345678901234567890123456789012")
		t.Setenv("DB_MAX_OPEN_CONNECTIONS", "2")
		t.Setenv("DB_MAX_IDLE_CONNECTIONS", "3")
		if _, err := LoadFromEnv(); err == nil || !strings.Contains(err.Error(), "DB_MAX_IDLE_CONNECTIONS") {
			t.Fatalf("idle/open connection error = %v", err)
		}
	})
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
