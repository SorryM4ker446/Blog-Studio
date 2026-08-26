package backup

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func createUploadArchive(uploadDir, destination string) (int, int64, error) {
	uploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return 0, 0, fmt.Errorf("resolve upload directory: %w", err)
	}
	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		return 0, 0, fmt.Errorf("read upload directory: %w", err)
	}
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return 0, 0, fmt.Errorf("create uploads archive: %w", err)
	}
	compressed := gzip.NewWriter(output)
	archive := tar.NewWriter(compressed)
	fileCount := 0
	var uncompressedSize int64
	writeErr := func() error {
		for _, entry := range entries {
			if entry.Name() == ".health" && entry.IsDir() {
				continue
			}
			path := filepath.Join(uploadDir, entry.Name())
			info, err := os.Lstat(path)
			if err != nil {
				return fmt.Errorf("inspect upload %q: %w", entry.Name(), err)
			}
			if !safeArchiveName(entry.Name()) || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("upload %q is not a safe regular file", entry.Name())
			}
			header := &tar.Header{
				Name:    entry.Name(),
				Mode:    0o600,
				Size:    info.Size(),
				ModTime: info.ModTime(),
			}
			if err := archive.WriteHeader(header); err != nil {
				return fmt.Errorf("write upload archive header: %w", err)
			}
			file, err := os.Open(path)
			if err != nil {
				return fmt.Errorf("open upload %q: %w", entry.Name(), err)
			}
			written, copyErr := io.Copy(archive, file)
			closeErr := file.Close()
			if copyErr != nil {
				return fmt.Errorf("archive upload %q: %w", entry.Name(), copyErr)
			}
			if closeErr != nil {
				return fmt.Errorf("close upload %q: %w", entry.Name(), closeErr)
			}
			if written != info.Size() {
				return fmt.Errorf("upload %q changed while it was being archived", entry.Name())
			}
			fileCount++
			uncompressedSize += written
		}
		return nil
	}()
	closeArchiveErr := archive.Close()
	closeCompressedErr := compressed.Close()
	if writeErr == nil {
		writeErr = output.Sync()
	}
	closeOutputErr := output.Close()
	for _, candidate := range []error{writeErr, closeArchiveErr, closeCompressedErr, closeOutputErr} {
		if candidate != nil {
			_ = os.Remove(destination)
			return 0, 0, candidate
		}
	}
	return fileCount, uncompressedSize, nil
}

func inspectUploadArchive(path string, extractDir *string) (int, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return 0, 0, err
	}
	defer compressed.Close()
	archive := tar.NewReader(compressed)
	seen := make(map[string]struct{})
	fileCount := 0
	var uncompressedSize int64
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return 0, 0, err
		}
		if header.Typeflag != tar.TypeReg || header.Size < 0 || !safeArchiveName(header.Name) {
			return 0, 0, fmt.Errorf("unsafe uploads archive entry %q", header.Name)
		}
		if _, duplicate := seen[header.Name]; duplicate {
			return 0, 0, fmt.Errorf("duplicate uploads archive entry %q", header.Name)
		}
		seen[header.Name] = struct{}{}
		var destination io.Writer = io.Discard
		var output *os.File
		if extractDir != nil {
			outputPath := filepath.Join(*extractDir, header.Name)
			output, err = os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				return 0, 0, err
			}
			destination = output
		}
		written, copyErr := io.CopyN(destination, archive, header.Size)
		if output != nil {
			if copyErr == nil {
				copyErr = output.Sync()
			}
			if closeErr := output.Close(); copyErr == nil {
				copyErr = closeErr
			}
		}
		if copyErr != nil {
			return 0, 0, copyErr
		}
		if written != header.Size {
			return 0, 0, fmt.Errorf("uploads archive entry %q is truncated", header.Name)
		}
		fileCount++
		uncompressedSize += written
	}
	return fileCount, uncompressedSize, nil
}

func safeArchiveName(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 &&
		filepath.Base(name) == name && !strings.ContainsAny(name, `/\\`)
}
