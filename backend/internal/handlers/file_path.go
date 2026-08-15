package handlers

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"blog-backend/internal/config"
	"blog-backend/internal/filestore"
	"blog-backend/internal/models"
)

func currentFileStore() (filestore.Store, error) {
	return filestore.NewLocalStore(config.Current().UploadDir)
}

func openStoredFile(store filestore.Store, record models.File) (string, *os.File, os.FileInfo, error) {
	seen := make(map[string]struct{})
	candidates := []string{strings.TrimSpace(record.Name)}
	if base := strings.TrimSpace(filepath.Base(record.Path)); base != "" && base != "." && base != string(filepath.Separator) {
		candidates = append(candidates, base)
	}
	for _, key := range candidates {
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		content, info, err := store.Open(key)
		if err == nil {
			return key, content, info, nil
		}
		if !errors.Is(err, os.ErrNotExist) && !errors.Is(err, filestore.ErrInvalidStorageKey) {
			continue
		}
	}
	return "", nil, nil, os.ErrNotExist
}
