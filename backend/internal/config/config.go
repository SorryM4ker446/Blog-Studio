package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

const minimumJWTSecretLength = 32

// AppConfig contains the process-wide configuration required by the server.
// Secrets must be supplied through the environment and never fall back to
// source-controlled development values.
type AppConfig struct {
	DatabaseDSN   string
	JWTSecret     []byte
	ServerAddress string
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

	cfg := AppConfig{
		DatabaseDSN:   databaseDSN,
		JWTSecret:     []byte(jwtSecret),
		ServerAddress: serverAddress,
	}

	configMu.Lock()
	appConfig = cfg
	loaded = true
	configMu.Unlock()

	return cfg, nil
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
