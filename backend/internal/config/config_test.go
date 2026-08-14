package config

import (
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
}
