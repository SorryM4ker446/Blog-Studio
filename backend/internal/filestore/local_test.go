package filestore

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalStoreConfinesAndCompensatesContent(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root)
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}

	written, err := store.Save("safe.txt", bytes.NewBufferString("safe content"), 64)
	if err != nil || written != int64(len("safe content")) {
		t.Fatalf("Save() = (%d, %v)", written, err)
	}
	content, _, err := store.Open("safe.txt")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	loaded, err := io.ReadAll(content)
	_ = content.Close()
	if err != nil || string(loaded) != "safe content" {
		t.Fatalf("stored content = %q, error = %v", loaded, err)
	}

	if _, err := store.Save("too-large.txt", bytes.NewBufferString("12345"), 4); !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("oversized Save() error = %v, want %v", err, ErrFileTooLarge)
	}
	if _, err := os.Stat(filepath.Join(root, "too-large.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("partial oversized content still exists: %v", err)
	}
	for _, key := range []string{"../outside.txt", `..\outside.txt`, "folder/file.txt", ".", "file.txt:stream", "CON.txt", "空.txt"} {
		if _, _, err := store.Open(key); !errors.Is(err, ErrInvalidStorageKey) {
			t.Fatalf("Open(%q) error = %v, want %v", key, err, ErrInvalidStorageKey)
		}
	}

	quarantineKey, err := store.Quarantine("safe.txt")
	if err != nil {
		t.Fatalf("Quarantine() error = %v", err)
	}
	if _, _, err := store.Open("safe.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("original content after quarantine error = %v", err)
	}
	if err := store.Restore(quarantineKey, "safe.txt"); err != nil {
		t.Fatalf("Restore() error = %v", err)
	}
	if err := store.Remove("safe.txt"); err != nil {
		t.Fatalf("Remove() error = %v", err)
	}
}

func TestLocalStoreRejectsSymlinkContent(t *testing.T) {
	root := t.TempDir()
	outsideRoot := t.TempDir()
	outsidePath := filepath.Join(outsideRoot, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("secret"), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	linkPath := filepath.Join(root, "link.txt")
	if err := os.Symlink(outsidePath, linkPath); err != nil {
		t.Skipf("symlinks are unavailable in this environment: %v", err)
	}
	store, err := NewLocalStore(root)
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	if _, _, err := store.Open("link.txt"); err == nil {
		t.Fatal("Open() followed a symlink outside the storage root")
	}
}
