package filestore

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrInvalidStorageKey = errors.New("invalid storage key")
	ErrFileTooLarge      = errors.New("file exceeds configured size limit")
)

type Store interface {
	Save(key string, source io.Reader, maxBytes int64) (int64, error)
	Open(key string) (*os.File, os.FileInfo, error)
	Quarantine(key string) (string, error)
	Restore(quarantineKey, originalKey string) error
	Remove(key string) error
	ListKeys() ([]string, error)
}

type LocalStore struct {
	root string
}

func NewLocalStore(root string) (*LocalStore, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("storage root is required")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve storage root: %w", err)
	}
	volumeRoot := filepath.Clean(filepath.VolumeName(absRoot) + string(filepath.Separator))
	if filepath.Clean(absRoot) == volumeRoot {
		return nil, errors.New("storage root must not be a filesystem root")
	}
	if err := os.MkdirAll(absRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create storage root: %w", err)
	}
	info, err := os.Stat(absRoot)
	if err != nil {
		return nil, fmt.Errorf("inspect storage root: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("storage root is not a directory")
	}
	return &LocalStore{root: filepath.Clean(absRoot)}, nil
}

func (s *LocalStore) Save(key string, source io.Reader, maxBytes int64) (int64, error) {
	path, err := s.pathForKey(key)
	if err != nil {
		return 0, err
	}
	destination, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return 0, err
	}
	limited := &io.LimitedReader{R: source, N: maxBytes + 1}
	written, copyErr := io.Copy(destination, limited)
	if copyErr == nil && written <= maxBytes {
		copyErr = destination.Sync()
	}
	closeErr := destination.Close()
	if written > maxBytes {
		copyErr = ErrFileTooLarge
	}
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(path)
		if copyErr != nil {
			return written, copyErr
		}
		return written, closeErr
	}
	return written, nil
}

func (s *LocalStore) Open(key string) (*os.File, os.FileInfo, error) {
	path, err := s.pathForKey(key)
	if err != nil {
		return nil, nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, nil, errors.New("stored content is not a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	return file, info, nil
}

func (s *LocalStore) Quarantine(key string) (string, error) {
	originalPath, err := s.pathForKey(key)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(originalPath)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("stored content is not a regular file")
	}
	quarantineKey, err := randomInternalKey(".deleting-")
	if err != nil {
		return "", err
	}
	quarantinePath, err := s.pathForKey(quarantineKey)
	if err != nil {
		return "", err
	}
	if err := os.Rename(originalPath, quarantinePath); err != nil {
		return "", err
	}
	return quarantineKey, nil
}

func (s *LocalStore) Restore(quarantineKey, originalKey string) error {
	quarantinePath, err := s.pathForKey(quarantineKey)
	if err != nil {
		return err
	}
	originalPath, err := s.pathForKey(originalKey)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(originalPath); err == nil {
		return errors.New("cannot restore over existing content")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(quarantinePath, originalPath)
}

func (s *LocalStore) Remove(key string) error {
	path, err := s.pathForKey(key)
	if err != nil {
		return err
	}
	return os.Remove(path)
}

func (s *LocalStore) ListKeys() ([]string, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		keys = append(keys, entry.Name())
	}
	return keys, nil
}

func (s *LocalStore) pathForKey(key string) (string, error) {
	if !validStorageKey(key) || filepath.Base(key) != key || strings.ContainsAny(key, `/\`) {
		return "", ErrInvalidStorageKey
	}
	path := filepath.Join(s.root, key)
	relative, err := filepath.Rel(s.root, path)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
		return "", ErrInvalidStorageKey
	}
	return path, nil
}

func validStorageKey(key string) bool {
	if key == "" || key == "." || key == ".." || len(key) > 255 || strings.HasSuffix(key, ".") || strings.HasSuffix(key, " ") {
		return false
	}
	for i := 0; i < len(key); i++ {
		character := key[i]
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '.' || character == '-' || character == '_' {
			continue
		}
		return false
	}
	base := strings.ToUpper(strings.TrimSuffix(key, filepath.Ext(key)))
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" {
		return false
	}
	if len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
		return false
	}
	return true
}

func randomInternalKey(prefix string) (string, error) {
	key, err := RandomStorageKey(".txt")
	if err != nil {
		return "", err
	}
	return prefix + strings.TrimSuffix(key, ".txt"), nil
}
