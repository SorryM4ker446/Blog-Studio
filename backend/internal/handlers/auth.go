package handlers

import (
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"blog-backend/internal/security"
	"blog-backend/internal/session"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

var (
	loginLimiter = security.NewLoginLimiter(5, 15*time.Minute)
	dummyHash    = mustHashDummyPassword()
)

func Login(c *gin.Context) {
	var creds Credentials
	if err := c.ShouldBindJSON(&creds); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}
	creds.Username = strings.TrimSpace(creds.Username)
	if creds.Username == "" || creds.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username and password are required"})
		return
	}

	ip := requestIP(c.Request.RemoteAddr)
	if allowed, retryAfter := loginLimiter.Allow(ip, creds.Username); !allowed {
		seconds := int(retryAfter.Seconds()) + 1
		c.Header("Retry-After", strconv.Itoa(seconds))
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many login attempts; try again later"})
		return
	}

	var user models.User
	result := config.DB.Where("username = ?", creds.Username).First(&user)
	hash := dummyHash
	if result.Error == nil {
		hash = []byte(user.PasswordHash)
	}
	passwordMatches := bcrypt.CompareHashAndPassword(hash, []byte(creds.Password)) == nil
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not verify credentials"})
		return
	}
	if result.Error != nil || !passwordMatches {
		loginLimiter.RecordFailure(ip, creds.Username)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	tokenString, err := session.Issue(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create session"})
		return
	}
	csrfToken, err := session.NewCSRFToken(c.Writer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create session"})
		return
	}
	loginLimiter.Reset(ip, creds.Username)
	session.SetCookie(c.Writer, tokenString)

	c.JSON(http.StatusOK, gin.H{
		"csrf_token": csrfToken,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
		},
	})
}

func CSRFToken(c *gin.Context) {
	token, err := session.NewCSRFToken(c.Writer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create CSRF token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"csrf_token": token})
}

func Logout(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	if err := config.DB.Model(&models.User{}).Where("id = ?", userID).
		UpdateColumn("session_version", gorm.Expr("session_version + 1")).Error; err != nil {
		session.ClearCookies(c.Writer)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to invalidate session"})
		return
	}
	session.ClearCookies(c.Writer)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func Me(c *gin.Context) {
	username, _ := c.Get("username")
	role, _ := c.Get("role")
	userID, _ := c.Get("user_id")
	c.JSON(http.StatusOK, gin.H{"id": userID, "username": username, "role": role})
}

func UpdatePassword(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	var user models.User
	if err := config.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Incorrect current password"})
		return
	}
	if input.CurrentPassword == input.NewPassword {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New password must be different from the current password"})
		return
	}
	if err := security.ValidatePassword(input.NewPassword, user.Username); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Println("Error hashing password:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}
	if err := config.DB.Model(&user).Updates(map[string]interface{}{
		"password_hash":   string(newHash),
		"session_version": gorm.Expr("session_version + 1"),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}
	session.ClearCookies(c.Writer)
	c.JSON(http.StatusOK, gin.H{"message": "Password updated; please sign in again"})
}

func requestIP(remoteAddress string) string {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err == nil {
		return host
	}
	return remoteAddress
}

func mustHashDummyPassword() []byte {
	hash, err := bcrypt.GenerateFromPassword([]byte("dummy-password-for-timing-only"), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return hash
}
