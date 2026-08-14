package middleware

import (
	"crypto/subtle"
	"net/http"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"blog-backend/internal/session"
	"github.com/gin-gonic/gin"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := authenticatedClaims(c)
		if !ok {
			session.ClearCookies(c.Writer)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
			return
		}

		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Set("user_id", claims.UserID)
		c.Next()
	}
}

func RequireAdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		roleName, ok := role.(string)
		if !exists || !ok || roleName != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			return
		}
		c.Next()
	}
}

func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		cookie, err := c.Cookie(session.CSRFCookieName)
		header := c.GetHeader("X-CSRF-Token")
		if err != nil || cookie == "" || header == "" || len(cookie) != len(header) || subtle.ConstantTimeCompare([]byte(cookie), []byte(header)) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Invalid CSRF token"})
			return
		}
		c.Next()
	}
}

func authenticatedClaims(c *gin.Context) (*session.Claims, bool) {
	tokenString, err := c.Cookie(session.CookieName)
	if err != nil || tokenString == "" {
		return nil, false
	}
	claims, err := session.Parse(tokenString)
	if err != nil {
		return nil, false
	}

	var user models.User
	if err := config.DB.First(&user, claims.UserID).Error; err != nil {
		return nil, false
	}
	if user.Username != claims.Username || user.Role != claims.Role || user.SessionVersion != claims.SessionVersion {
		return nil, false
	}
	return claims, true
}
