package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/golang-jwt/jwt/v5"
)

const (
	CookieName     = "blog_session"
	CSRFCookieName = "blog_csrf"
	issuer         = "blog-studio"
	lifetime       = 24 * time.Hour
)

type Claims struct {
	Username       string `json:"username"`
	Role           string `json:"role"`
	UserID         uint   `json:"user_id"`
	SessionVersion uint   `json:"session_version"`
	jwt.RegisteredClaims
}

func Issue(user models.User) (string, error) {
	now := time.Now()
	jti, err := randomToken(16)
	if err != nil {
		return "", err
	}
	claims := Claims{
		Username:       user.Username,
		Role:           user.Role,
		UserID:         user.ID,
		SessionVersion: user.SessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   strconv.FormatUint(uint64(user.ID), 10),
			ExpiresAt: jwt.NewNumericDate(now.Add(lifetime)),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        jti,
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(config.Current().JWTSecret)
}

func Parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(_ *jwt.Token) (interface{}, error) { return config.Current().JWTSecret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid || claims.UserID == 0 || claims.Subject != strconv.FormatUint(uint64(claims.UserID), 10) {
		return nil, errors.New("invalid session")
	}
	return claims, nil
}

func SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/api",
		MaxAge:   int(lifetime.Seconds()),
		Expires:  time.Now().Add(lifetime),
		HttpOnly: true,
		Secure:   config.Current().CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func ClearCookies(w http.ResponseWriter) {
	for _, cookie := range []*http.Cookie{
		{Name: CookieName, Path: "/api", HttpOnly: true},
		{Name: CSRFCookieName, Path: "/"},
	} {
		cookie.Value = ""
		cookie.MaxAge = -1
		cookie.Expires = time.Unix(1, 0)
		cookie.Secure = config.Current().CookieSecure
		cookie.SameSite = http.SameSiteLaxMode
		http.SetCookie(w, cookie)
	}
}

func NewCSRFToken(w http.ResponseWriter) (string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(lifetime.Seconds()),
		Expires:  time.Now().Add(lifetime),
		HttpOnly: false,
		Secure:   config.Current().CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return token, nil
}

func randomToken(size int) (string, error) {
	random := make([]byte, size)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random), nil
}
