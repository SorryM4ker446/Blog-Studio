package filestore

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// PrepareMultipartTempDir keeps multipart files on the upload volume, outside
// the stored-file namespace and the upload archive.
func PrepareMultipartTempDir(uploadDir string) (string, error) {
	root, err := filepath.Abs(uploadDir)
	if err != nil {
		return "", fmt.Errorf("resolve upload directory: %w", err)
	}
	healthDir := filepath.Join(root, ".health")
	if err := ensurePrivateDirectory(healthDir); err != nil {
		return "", err
	}
	tempDir := filepath.Join(healthDir, "multipart")
	if err := ensurePrivateDirectory(tempDir); err != nil {
		return "", err
	}

	entries, err := os.ReadDir(tempDir)
	if err != nil {
		return "", fmt.Errorf("read multipart temporary directory: %w", err)
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "multipart-") || !entry.Type().IsRegular() {
			return "", fmt.Errorf("unexpected entry in multipart temporary directory: %q", entry.Name())
		}
		if err := os.Remove(filepath.Join(tempDir, entry.Name())); err != nil {
			return "", fmt.Errorf("remove stale multipart file: %w", err)
		}
	}

	probe, err := os.CreateTemp(tempDir, "multipart-probe-")
	if err != nil {
		return "", fmt.Errorf("write multipart temporary directory: %w", err)
	}
	if err := probe.Close(); err != nil {
		_ = os.Remove(probe.Name())
		return "", fmt.Errorf("close multipart temporary probe: %w", err)
	}
	if err := os.Remove(probe.Name()); err != nil {
		return "", fmt.Errorf("remove multipart temporary probe: %w", err)
	}
	return tempDir, nil
}

func ensurePrivateDirectory(path string) error {
	if err := os.Mkdir(path, 0o700); err != nil && !os.IsExist(err) {
		return fmt.Errorf("create multipart temporary directory: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect multipart temporary directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("multipart temporary path is not a safe directory: %s", path)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("multipart temporary directory permits access by other users: %s", path)
	}
	return nil
}
