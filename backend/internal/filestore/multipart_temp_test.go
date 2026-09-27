package filestore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareMultipartTempDirCleansInterruptedUploads(t *testing.T) {
	root := t.TempDir()
	tempDir, err := PrepareMultipartTempDir(root)
	if err != nil {
		t.Fatalf("prepare multipart temporary directory: %v", err)
	}
	stale := filepath.Join(tempDir, "multipart-interrupted")
	if err := os.WriteFile(stale, []byte("incomplete upload"), 0o600); err != nil {
		t.Fatal(err)
	}
	staleProbe := filepath.Join(tempDir, "multipart-probe-interrupted")
	if err := os.WriteFile(staleProbe, []byte("incomplete startup check"), 0o600); err != nil {
		t.Fatal(err)
	}
	readiness := filepath.Join(root, ".health", "readiness-preserved")
	if err := os.WriteFile(readiness, []byte("health probe"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareMultipartTempDir(root); err != nil {
		t.Fatalf("prepare after interrupted upload: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale multipart content remains: %v", err)
	}
	if _, err := os.Stat(staleProbe); !os.IsNotExist(err) {
		t.Fatalf("stale startup probe remains: %v", err)
	}
	if _, err := os.Stat(readiness); err != nil {
		t.Fatalf("unrelated health content changed: %v", err)
	}
	store, err := NewLocalStore(root)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := store.ListKeys()
	if err != nil || len(keys) != 0 {
		t.Fatalf("temporary directory appeared as stored content: keys=%v error=%v", keys, err)
	}
}

func TestPrepareMultipartTempDirRejectsUnsafePaths(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, ".health")); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}
	if _, err := PrepareMultipartTempDir(root); err == nil {
		t.Fatal("multipart temporary directory followed a symlink")
	}
}

func TestPrepareMultipartTempDirPreservesUnexpectedFiles(t *testing.T) {
	root := t.TempDir()
	tempDir, err := PrepareMultipartTempDir(root)
	if err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(tempDir, "operator-note")
	if err := os.WriteFile(other, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareMultipartTempDir(root); err == nil {
		t.Fatal("unexpected multipart temporary entry was silently ignored")
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatalf("unexpected entry was removed: %v", err)
	}
}
