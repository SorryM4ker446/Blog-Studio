package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

const (
	minimumJWTSecretLength = 32
	defaultMaxUploadBytes  = int64(10 * 1024 * 1024)
	maximumMaxUploadBytes  = int64(100 * 1024 * 1024)
)

// AppConfig contains the process-wide configuration required by the server.
// Secrets must be supplied through the environment and never fall back to
// source-controlled development values.
type AppConfig struct {
	DatabaseDSN    string
	JWTSecret      []byte
	ServerAddress  string
	Environment    string
	AllowedOrigins []string
	CookieSecure   bool
	MaxUploadBytes int64
	UploadDir      string
}

var (
	appConfig AppConfig
	configMu  sync.RWMutex
	loaded    bool
)

// LoadFromEnv validates environment configuration and makes it available to
// packages that handle requests. It must run before the database or router is
// initialized.
func LoadFromEnv() (AppConfig, error) {
	databaseDSN := strings.TrimSpace(os.Getenv("DB_DSN"))
	if databaseDSN == "" {
		return AppConfig{}, errors.New("DB_DSN is required")
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" {
		return AppConfig{}, errors.New("JWT_SECRET is required")
	}
	if len([]byte(jwtSecret)) < minimumJWTSecretLength {
		return AppConfig{}, fmt.Errorf("JWT_SECRET must be at least %d bytes", minimumJWTSecretLength)
	}

	serverAddress := strings.TrimSpace(os.Getenv("SERVER_ADDRESS"))
	if serverAddress == "" {
		serverAddress = ":8080"
	}

	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment == "" {
		environment = "development"
	}
	if environment != "development" && environment != "test" && environment != "production" {
		return AppConfig{}, errors.New("APP_ENV must be development, test, or production")
	}

	allowedOrigins, err := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"), environment)
	if err != nil {
		return AppConfig{}, err
	}

	cookieSecure := environment == "production"
	if raw := strings.TrimSpace(os.Getenv("COOKIE_SECURE")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return AppConfig{}, errors.New("COOKIE_SECURE must be true or false")
		}
		cookieSecure = parsed
	}
	if environment == "production" && !cookieSecure {
		return AppConfig{}, errors.New("COOKIE_SECURE must be true in production")
	}

	maxUploadBytes := defaultMaxUploadBytes
	if raw := strings.TrimSpace(os.Getenv("MAX_UPLOAD_BYTES")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 || parsed > maximumMaxUploadBytes {
			return AppConfig{}, fmt.Errorf("MAX_UPLOAD_BYTES must be an integer from 1 through %d", maximumMaxUploadBytes)
		}
		maxUploadBytes = parsed
	}
	uploadDir := strings.TrimSpace(os.Getenv("UPLOAD_DIR"))
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	uploadDir, err = filepath.Abs(uploadDir)
	if err != nil {
		return AppConfig{}, fmt.Errorf("UPLOAD_DIR must resolve to a valid filesystem path: %w", err)
	}
	volumeRoot := filepath.Clean(filepath.VolumeName(uploadDir) + string(filepath.Separator))
	if filepath.Clean(uploadDir) == volumeRoot {
		return AppConfig{}, errors.New("UPLOAD_DIR must not be a filesystem root")
	}
	if info, statErr := os.Stat(uploadDir); statErr == nil && !info.IsDir() {
		return AppConfig{}, errors.New("UPLOAD_DIR must be a directory")
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return AppConfig{}, fmt.Errorf("UPLOAD_DIR cannot be inspected: %w", statErr)
	}

	cfg := AppConfig{
		DatabaseDSN:    databaseDSN,
		JWTSecret:      []byte(jwtSecret),
		ServerAddress:  serverAddress,
		Environment:    environment,
		AllowedOrigins: allowedOrigins,
		CookieSecure:   cookieSecure,
		MaxUploadBytes: maxUploadBytes,
		UploadDir:      filepath.Clean(uploadDir),
	}

	configMu.Lock()
	appConfig = cfg
	loaded = true
	configMu.Unlock()

	return cfg, nil
}

func parseAllowedOrigins(raw, environment string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		if environment == "production" {
			return nil, errors.New("ALLOWED_ORIGINS is required in production")
		}
		return []string{"http://localhost:3000", "http://127.0.0.1:3000"}, nil
	}

	seen := make(map[string]struct{})
	origins := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		origin := strings.TrimRight(strings.TrimSpace(value), "/")
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("invalid allowed origin %q", value)
		}
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	if len(origins) == 0 {
		return nil, errors.New("ALLOWED_ORIGINS must contain at least one origin")
	}
	return origins, nil
}

// Current returns the validated process configuration. Calling it before
// LoadFromEnv is a programming error, so it fails fast instead of silently
// using insecure defaults.
func Current() AppConfig {
	configMu.RLock()
	defer configMu.RUnlock()

	if !loaded {
		panic("application configuration has not been loaded")
	}

	return appConfig
}
