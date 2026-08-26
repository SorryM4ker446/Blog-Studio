package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	minimumJWTSecretLength      = 32
	defaultMaxUploadBytes       = int64(10 * 1024 * 1024)
	maximumMaxUploadBytes       = int64(100 * 1024 * 1024)
	defaultDBMaxOpenConnections = 10
	defaultDBMaxIdleConnections = 5
	maximumDBConnections        = 100
	defaultDBConnectionLifetime = 30 * time.Minute
	defaultDBConnectionIdleTime = 5 * time.Minute
	defaultReadHeaderTimeout    = 5 * time.Second
	defaultReadTimeout          = 2 * time.Minute
	defaultWriteTimeout         = 5 * time.Minute
	defaultIdleTimeout          = 2 * time.Minute
	defaultShutdownTimeout      = 20 * time.Second
	defaultHealthCheckTimeout   = 2 * time.Second
	defaultPublicSearchRate     = 120
	defaultPublicSearchBurst    = 30
	maximumPublicSearchRate     = 60_000
	maximumPublicSearchBurst    = 1_000
	maximumOperationalDuration  = 30 * time.Minute
	maximumConnectionDuration   = 24 * time.Hour
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
	TrustedProxies []string

	DBMaxOpenConnections int
	DBMaxIdleConnections int
	DBConnectionLifetime time.Duration
	DBConnectionIdleTime time.Duration

	HTTPReadHeaderTimeout time.Duration
	HTTPReadTimeout       time.Duration
	HTTPWriteTimeout      time.Duration
	HTTPIdleTimeout       time.Duration
	HTTPShutdownTimeout   time.Duration
	HealthCheckTimeout    time.Duration

	PublicSearchRatePerMinute int
	PublicSearchBurst         int
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
	databaseDSN, err := DatabaseDSNFromEnv()
	if err != nil {
		return AppConfig{}, err
	}

	jwtSecret, err := ReadEnvironmentValue("JWT_SECRET")
	if err != nil {
		return AppConfig{}, err
	}
	jwtSecret = strings.TrimSpace(jwtSecret)
	if jwtSecret == "" {
		return AppConfig{}, errors.New("JWT_SECRET is required unless JWT_SECRET_FILE is configured")
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
	trustedProxies, err := parseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return AppConfig{}, err
	}
	dbMaxOpenConnections, err := parseInteger(
		"DB_MAX_OPEN_CONNECTIONS",
		defaultDBMaxOpenConnections,
		1,
		maximumDBConnections,
	)
	if err != nil {
		return AppConfig{}, err
	}
	dbMaxIdleConnections, err := parseInteger(
		"DB_MAX_IDLE_CONNECTIONS",
		defaultDBMaxIdleConnections,
		0,
		maximumDBConnections,
	)
	if err != nil {
		return AppConfig{}, err
	}
	if dbMaxIdleConnections > dbMaxOpenConnections {
		return AppConfig{}, errors.New("DB_MAX_IDLE_CONNECTIONS must not exceed DB_MAX_OPEN_CONNECTIONS")
	}
	dbConnectionLifetime, err := parseDuration(
		"DB_CONNECTION_MAX_LIFETIME",
		defaultDBConnectionLifetime,
		maximumConnectionDuration,
	)
	if err != nil {
		return AppConfig{}, err
	}
	dbConnectionIdleTime, err := parseDuration(
		"DB_CONNECTION_MAX_IDLE_TIME",
		defaultDBConnectionIdleTime,
		maximumConnectionDuration,
	)
	if err != nil {
		return AppConfig{}, err
	}
	httpReadHeaderTimeout, err := parseDuration(
		"HTTP_READ_HEADER_TIMEOUT",
		defaultReadHeaderTimeout,
		maximumOperationalDuration,
	)
	if err != nil {
		return AppConfig{}, err
	}
	httpReadTimeout, err := parseDuration("HTTP_READ_TIMEOUT", defaultReadTimeout, maximumOperationalDuration)
	if err != nil {
		return AppConfig{}, err
	}
	httpWriteTimeout, err := parseDuration("HTTP_WRITE_TIMEOUT", defaultWriteTimeout, maximumOperationalDuration)
	if err != nil {
		return AppConfig{}, err
	}
	httpIdleTimeout, err := parseDuration("HTTP_IDLE_TIMEOUT", defaultIdleTimeout, maximumOperationalDuration)
	if err != nil {
		return AppConfig{}, err
	}
	httpShutdownTimeout, err := parseDuration("HTTP_SHUTDOWN_TIMEOUT", defaultShutdownTimeout, maximumOperationalDuration)
	if err != nil {
		return AppConfig{}, err
	}
	healthCheckTimeout, err := parseDuration("HEALTH_CHECK_TIMEOUT", defaultHealthCheckTimeout, maximumOperationalDuration)
	if err != nil {
		return AppConfig{}, err
	}
	publicSearchRate, err := parseInteger(
		"PUBLIC_SEARCH_RATE_PER_MINUTE",
		defaultPublicSearchRate,
		1,
		maximumPublicSearchRate,
	)
	if err != nil {
		return AppConfig{}, err
	}
	publicSearchBurst, err := parseInteger(
		"PUBLIC_SEARCH_BURST",
		defaultPublicSearchBurst,
		1,
		maximumPublicSearchBurst,
	)
	if err != nil {
		return AppConfig{}, err
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
		TrustedProxies: trustedProxies,

		DBMaxOpenConnections: dbMaxOpenConnections,
		DBMaxIdleConnections: dbMaxIdleConnections,
		DBConnectionLifetime: dbConnectionLifetime,
		DBConnectionIdleTime: dbConnectionIdleTime,

		HTTPReadHeaderTimeout: httpReadHeaderTimeout,
		HTTPReadTimeout:       httpReadTimeout,
		HTTPWriteTimeout:      httpWriteTimeout,
		HTTPIdleTimeout:       httpIdleTimeout,
		HTTPShutdownTimeout:   httpShutdownTimeout,
		HealthCheckTimeout:    healthCheckTimeout,

		PublicSearchRatePerMinute: publicSearchRate,
		PublicSearchBurst:         publicSearchBurst,
	}

	configMu.Lock()
	appConfig = cfg
	loaded = true
	configMu.Unlock()

	return cfg, nil
}

func parseTrustedProxies(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	seen := make(map[string]struct{})
	proxies := make([]string, 0)
	for _, value := range strings.Split(raw, ",") {
		proxy := strings.TrimSpace(value)
		if proxy == "" {
			return nil, errors.New("TRUSTED_PROXIES must not contain empty entries")
		}
		if ip := net.ParseIP(proxy); ip != nil {
			proxy = ip.String()
		} else if _, network, parseErr := net.ParseCIDR(proxy); parseErr == nil {
			proxy = network.String()
		} else {
			return nil, fmt.Errorf("TRUSTED_PROXIES contains invalid address or CIDR %q", value)
		}
		if _, exists := seen[proxy]; exists {
			continue
		}
		seen[proxy] = struct{}{}
		proxies = append(proxies, proxy)
	}
	return proxies, nil
}

func parseInteger(name string, fallback, minimum, maximum int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be an integer from %d through %d", name, minimum, maximum)
	}
	return value, nil
}

func parseDuration(name string, fallback, maximum time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 || value > maximum {
		return 0, fmt.Errorf("%s must be a positive duration no greater than %s", name, maximum)
	}
	return value, nil
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
