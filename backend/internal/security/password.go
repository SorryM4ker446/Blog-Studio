package security

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	minimumPasswordLength = 12
	maximumPasswordLength = 128
	maximumBcryptBytes    = 72
)

var commonPasswords = map[string]struct{}{
	"123456789012":  {},
	"admin123456":   {},
	"password1234":  {},
	"qwerty123456":  {},
	"letmein123456": {},
}

// ValidatePassword applies the same password rules to seeded and changed
// credentials so accounts cannot bypass policy through an administrative path.
func ValidatePassword(password, username string) error {
	length := utf8.RuneCountInString(password)
	if length < minimumPasswordLength {
		return errors.New("password must be at least 12 characters")
	}
	if length > maximumPasswordLength {
		return errors.New("password must be at most 128 characters")
	}
	if len([]byte(password)) > maximumBcryptBytes {
		return errors.New("password must be at most 72 UTF-8 bytes")
	}

	normalized := strings.ToLower(strings.TrimSpace(password))
	if _, found := commonPasswords[normalized]; found {
		return errors.New("password is too common")
	}
	username = strings.ToLower(strings.TrimSpace(username))
	if len([]rune(username)) >= 3 && strings.Contains(normalized, username) {
		return errors.New("password must not contain the username")
	}
	return nil
}
