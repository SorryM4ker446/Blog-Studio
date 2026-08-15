package filestore

import (
	"bytes"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
	"testing"
)

const onePixelPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestDetectAllowedTypeUsesContentAndExtension(t *testing.T) {
	png, err := base64.StdEncoding.DecodeString(onePixelPNGBase64)
	if err != nil {
		t.Fatalf("decode PNG fixture: %v", err)
	}
	tests := []struct {
		name     string
		filename string
		content  []byte
		wantMIME string
		wantErr  error
	}{
		{name: "PNG", filename: "avatar.png", content: png, wantMIME: "image/png"},
		{name: "Markdown", filename: "notes.md", content: []byte("# Safe notes\n"), wantMIME: "text/markdown; charset=utf-8"},
		{name: "Windows UTF-16LE TXT", filename: "notepad.txt", content: []byte{0xff, 0xfe, 'H', 0x00, 'e', 0x00, 'l', 0x00, 'l', 0x00, 'o', 0x00}, wantMIME: "text/plain; charset=utf-8"},
		{name: "CSV disguised as TXT", filename: "table.txt", content: []byte("name,role\nAlice,admin\nBob,editor\n"), wantErr: ErrContentTypeMismatch},
		{name: "JSON disguised as TXT", filename: "payload.txt", content: []byte(`{"safe":"text document"}`), wantErr: ErrContentTypeMismatch},
		{name: "PDF", filename: "guide.pdf", content: []byte("%PDF-1.7\n% fixture"), wantMIME: "application/pdf"},
		{name: "unsupported extension", filename: "image.svg", content: []byte("<svg></svg>"), wantErr: ErrUnsupportedType},
		{name: "HTML disguised as text", filename: "page.txt", content: []byte("<!doctype html><script>alert(1)</script>"), wantErr: ErrContentTypeMismatch},
		{name: "XML disguised as text", filename: "feed.txt", content: []byte(`<?xml version="1.0"?><rss version="2.0"></rss>`), wantErr: ErrContentTypeMismatch},
		{name: "script disguised as text", filename: "script.txt", content: []byte("#!/usr/bin/env python3\nprint('unsafe')\n"), wantErr: ErrContentTypeMismatch},
		{name: "text disguised as image", filename: "fake.png", content: []byte("not an image"), wantErr: ErrContentTypeMismatch},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := DetectAllowedType(bytes.NewReader(tt.content), tt.filename)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("DetectAllowedType() error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("DetectAllowedType() error = %v", err)
			}
			if result.MIME != tt.wantMIME {
				t.Fatalf("MIME = %q, want %q", result.MIME, tt.wantMIME)
			}
		})
	}
}

func TestSanitizeOriginalName(t *testing.T) {
	name, err := SanitizeOriginalName(`..\private/../avatar?.PNG`)
	if err != nil {
		t.Fatalf("SanitizeOriginalName() error = %v", err)
	}
	if name != "avatar_.PNG" {
		t.Fatalf("sanitized name = %q, want %q", name, "avatar_.PNG")
	}
	longName, err := SanitizeOriginalName(strings.Repeat("界", 200) + ".txt")
	if err != nil {
		t.Fatalf("sanitize long name: %v", err)
	}
	if len(longName) > 255 || !strings.HasSuffix(longName, ".txt") {
		t.Fatalf("long sanitized name has %d bytes: %q", len(longName), longName)
	}
	if _, err := SanitizeOriginalName("bad\x00name.png"); !errors.Is(err, ErrInvalidFileName) {
		t.Fatalf("NUL name error = %v, want %v", err, ErrInvalidFileName)
	}
}

func TestRandomStorageKeyIsUnpredictableAndExtensionBound(t *testing.T) {
	first, err := RandomStorageKey(".PNG")
	if err != nil {
		t.Fatalf("first key: %v", err)
	}
	second, err := RandomStorageKey(".png")
	if err != nil {
		t.Fatalf("second key: %v", err)
	}
	pattern := regexp.MustCompile(`^[0-9a-f]{32}\.png$`)
	if first == second || !pattern.MatchString(first) || !pattern.MatchString(second) {
		t.Fatalf("random keys = %q and %q", first, second)
	}
}
