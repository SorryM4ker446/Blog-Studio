package handlers

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func resolveUploadDir() string {
	if customDir := strings.TrimSpace(os.Getenv("UPLOAD_DIR")); customDir != "" {
		if abs, err := filepath.Abs(customDir); err == nil {
			return abs
		}
		return customDir
	}

	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}

	candidates := []string{
		filepath.Join(wd, "uploads"),
		filepath.Join(wd, "backend", "uploads"),
		filepath.Join(wd, "Blog-Studio", "backend", "uploads"),
		filepath.Join(wd, "..", "uploads"),
		filepath.Join(wd, "..", "backend", "uploads"),
	}

	for _, candidate := range candidates {
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			if abs, absErr := filepath.Abs(candidate); absErr == nil {
				return abs
			}
			return candidate
		}
	}

	fallback := filepath.Join(wd, "uploads")
	if abs, absErr := filepath.Abs(fallback); absErr == nil {
		return abs
	}
	return fallback
}

func resolveStoredFilePath(storedPath, storedName string) (string, error) {
	candidates := make([]string, 0, 6)
	addCandidate := func(path string) {
		if strings.TrimSpace(path) == "" {
			return
		}
		candidates = append(candidates, path)
	}

	addCandidate(storedPath)
	if base := strings.TrimSpace(filepath.Base(storedPath)); base != "" && base != "." && base != string(filepath.Separator) {
		addCandidate(filepath.Join(uploadDir, base))
	}
	if storedName != "" {
		addCandidate(filepath.Join(uploadDir, storedName))
	}

	for _, candidate := range candidates {
		if resolved, ok := resolveCandidatePath(candidate); ok {
			return resolved, nil
		}
	}

	return "", errors.New("file not found on disk")
}

func resolveCandidatePath(candidate string) (string, bool) {
	cleaned := filepath.Clean(candidate)
	possiblePaths := []string{cleaned}

	if !filepath.IsAbs(cleaned) {
		possiblePaths = append(possiblePaths, filepath.Join(filepath.Dir(uploadDir), cleaned))
		possiblePaths = append(possiblePaths, filepath.Join(uploadDir, filepath.Base(cleaned)))
	}

	for _, path := range possiblePaths {
		absPath, absErr := filepath.Abs(path)
		if absErr != nil {
			continue
		}
		if info, statErr := os.Stat(absPath); statErr == nil && !info.IsDir() {
			return absPath, true
		}
	}

	return "", false
}
