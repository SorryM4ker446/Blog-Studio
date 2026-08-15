package filestore

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"path"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gabriel-vasile/mimetype"
)

var (
	ErrInvalidFileName     = errors.New("invalid file name")
	ErrUnsupportedType     = errors.New("unsupported file type")
	ErrContentTypeMismatch = errors.New("file content does not match its extension")
)

type FileType struct {
	Extension string
	MIME      string
	Inline    bool
}

type typeRule struct {
	canonicalMIME string
	detectedMIMEs []string
	inline        bool
}

var allowedTypes = map[string]typeRule{
	".jpg":  {"image/jpeg", []string{"image/jpeg"}, true},
	".jpeg": {"image/jpeg", []string{"image/jpeg"}, true},
	".png":  {"image/png", []string{"image/png"}, true},
	".gif":  {"image/gif", []string{"image/gif"}, true},
	".webp": {"image/webp", []string{"image/webp"}, true},
	".pdf":  {"application/pdf", []string{"application/pdf"}, false},
	".txt":  {"text/plain; charset=utf-8", []string{"text/plain"}, false},
	".md":   {"text/markdown; charset=utf-8", []string{"text/plain", "text/markdown"}, false},
	".csv":  {"text/csv; charset=utf-8", []string{"text/plain", "text/csv"}, false},
	".json": {"application/json", []string{"text/plain", "application/json"}, false},
	".zip":  {"application/zip", []string{"application/zip"}, false},
	".doc":  {"application/msword", []string{"application/msword"}, false},
	".xls":  {"application/vnd.ms-excel", []string{"application/vnd.ms-excel"}, false},
	".ppt":  {"application/vnd.ms-powerpoint", []string{"application/vnd.ms-powerpoint"}, false},
	".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", []string{"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, false},
	".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", []string{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, false},
	".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", []string{"application/vnd.openxmlformats-officedocument.presentationml.presentation"}, false},
}

func init() {
	// Office container signatures may occur after the first few kilobytes.
	mimetype.SetLimit(64 * 1024)
}

func DetectAllowedType(reader io.ReadSeeker, originalName string) (FileType, error) {
	extension := strings.ToLower(filepath.Ext(originalName))
	rule, ok := allowedTypes[extension]
	if !ok {
		return FileType{}, ErrUnsupportedType
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return FileType{}, err
	}
	detected, err := mimetype.DetectReader(reader)
	if err != nil {
		return FileType{}, err
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return FileType{}, err
	}
	if !mimetype.EqualsAny(detected.String(), rule.detectedMIMEs...) {
		return FileType{}, ErrContentTypeMismatch
	}
	return FileType{Extension: extension, MIME: rule.canonicalMIME, Inline: rule.inline}, nil
}

func SanitizeOriginalName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsRune(value, '\x00') {
		return "", ErrInvalidFileName
	}
	value = strings.ReplaceAll(value, `\`, "/")
	value = path.Base(value)
	if value == "." || value == ".." || value == "/" {
		return "", ErrInvalidFileName
	}

	var builder strings.Builder
	for _, r := range value {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			builder.WriteRune('_')
			continue
		}
		builder.WriteRune(r)
	}
	cleaned := strings.Trim(builder.String(), " .")
	if cleaned == "" {
		return "", ErrInvalidFileName
	}

	extension := filepath.Ext(cleaned)
	base := strings.TrimSuffix(cleaned, extension)
	if len(extension) >= 255 {
		return "", ErrInvalidFileName
	}
	base = truncateUTF8(base, 255-len(extension))
	cleaned = strings.Trim(base, " .") + extension
	if cleaned == "" || len(cleaned) > 255 {
		return "", ErrInvalidFileName
	}
	return cleaned, nil
}

func RandomStorageKey(extension string) (string, error) {
	if _, ok := allowedTypes[strings.ToLower(extension)]; !ok {
		return "", ErrUnsupportedType
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random) + strings.ToLower(extension), nil
}

func truncateUTF8(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	var builder strings.Builder
	for _, r := range value {
		size := utf8.RuneLen(r)
		if size < 0 || builder.Len()+size > maxBytes {
			break
		}
		builder.WriteRune(r)
	}
	return builder.String()
}
