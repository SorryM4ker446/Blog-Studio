package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const maximumEnvironmentFileBytes = 64 * 1024

var simpleDatabaseIdentifier = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// ReadEnvironmentValue reads NAME or NAME_FILE and rejects ambiguous input.
// The file form is intended for container secrets mounted under /run/secrets.
func ReadEnvironmentValue(name string) (string, error) {
	direct := os.Getenv(name)
	filePath := strings.TrimSpace(os.Getenv(name + "_FILE"))
	if strings.TrimSpace(direct) != "" && filePath != "" {
		return "", fmt.Errorf("%s and %s_FILE must not both be set", name, name)
	}
	if filePath == "" {
		return direct, nil
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return "", fmt.Errorf("read %s_FILE: %w", name, err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s_FILE must reference a regular file", name)
	}
	if info.Size() > maximumEnvironmentFileBytes {
		return "", fmt.Errorf("%s_FILE exceeds %d bytes", name, maximumEnvironmentFileBytes)
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("read %s_FILE: %w", name, err)
	}
	return strings.TrimRight(string(content), "\r\n"), nil
}

// DatabaseDSNFromEnv keeps DB_DSN compatibility while allowing deployments to
// assemble the connection URL from non-secret fields and a mounted password.
func DatabaseDSNFromEnv() (string, error) {
	dsn, err := ReadEnvironmentValue("DB_DSN")
	if err != nil {
		return "", err
	}
	dsn = strings.TrimSpace(dsn)
	if dsn != "" {
		return dsn, nil
	}

	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	user := strings.TrimSpace(os.Getenv("DB_USER"))
	database := strings.TrimSpace(os.Getenv("DB_NAME"))
	password, err := ReadEnvironmentValue("DB_PASSWORD")
	if err != nil {
		return "", err
	}
	if host == "" || user == "" || database == "" || password == "" {
		return "", errors.New("DB_DSN is required unless DB_HOST, DB_USER, DB_NAME, and DB_PASSWORD/DB_PASSWORD_FILE are configured")
	}
	if strings.ContainsAny(host, "/?#@") || strings.ContainsAny(host, " \t\r\n") {
		return "", errors.New("DB_HOST is invalid")
	}
	if !simpleDatabaseIdentifier.MatchString(user) {
		return "", errors.New("DB_USER contains unsupported characters; use DB_DSN for advanced connection settings")
	}
	if !simpleDatabaseIdentifier.MatchString(database) {
		return "", errors.New("DB_NAME contains unsupported characters; use DB_DSN for advanced connection settings")
	}

	port := 5432
	if rawPort := strings.TrimSpace(os.Getenv("DB_PORT")); rawPort != "" {
		port, err = strconv.Atoi(rawPort)
		if err != nil || port < 1 || port > 65535 {
			return "", errors.New("DB_PORT must be an integer from 1 through 65535")
		}
	}
	sslMode := strings.ToLower(strings.TrimSpace(os.Getenv("DB_SSLMODE")))
	if sslMode == "" {
		sslMode = "require"
	}
	switch sslMode {
	case "disable", "allow", "prefer", "require", "verify-ca", "verify-full":
	default:
		return "", errors.New("DB_SSLMODE is invalid")
	}
	timezone := strings.TrimSpace(os.Getenv("DB_TIMEZONE"))
	if timezone == "" {
		timezone = "UTC"
	}

	query := url.Values{
		"sslmode":  []string{sslMode},
		"timezone": []string{timezone},
	}
	connectionURL := &url.URL{
		Scheme:   "postgresql",
		User:     url.UserPassword(user, password),
		Host:     net.JoinHostPort(host, strconv.Itoa(port)),
		Path:     "/" + database,
		RawQuery: query.Encode(),
	}
	return connectionURL.String(), nil
}
