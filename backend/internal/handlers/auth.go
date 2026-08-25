package handlers

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"blog-backend/internal/observability"
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
	if !bindJSON(c, &creds) {
		return
	}
	creds.Username = strings.TrimSpace(creds.Username)
	if creds.Username == "" || creds.Password == "" {
		apiresponse.Error(c, http.StatusBadRequest, "missing_credentials", "Username and password are required")
		return
	}

	ip := requestIP(c.Request.RemoteAddr)
	if allowed, retryAfter := loginLimiter.Allow(ip, creds.Username); !allowed {
		seconds := int(retryAfter.Seconds()) + 1
		c.Header("Retry-After", strconv.Itoa(seconds))
		apiresponse.Error(c, http.StatusTooManyRequests, "login_rate_limited", "Too many login attempts; try again later")
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
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not verify credentials")
		return
	}
	if result.Error != nil || !passwordMatches {
		loginLimiter.RecordFailure(ip, creds.Username)
		apiresponse.Error(c, http.StatusUnauthorized, "invalid_credentials", "Invalid username or password")
		return
	}

	tokenString, err := session.Issue(user)
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "session_error", "Could not create session")
		return
	}
	csrfToken, err := session.NewCSRFToken(c.Writer)
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "session_error", "Could not create session")
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
		apiresponse.Error(c, http.StatusInternalServerError, "session_error", "Could not create CSRF token")
		return
	}
	c.JSON(http.StatusOK, gin.H{"csrf_token": token})
}

func Logout(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		apiresponse.Error(c, http.StatusUnauthorized, "unauthorized", "Unauthorized")
		return
	}
	result := config.DB.Model(&models.User{}).Where("id = ?", userID).
		UpdateColumn("session_version", gorm.Expr("session_version + 1"))
	if result.Error != nil || result.RowsAffected == 0 {
		session.ClearCookies(c.Writer)
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Failed to invalidate session")
		return
	}
	session.ClearCookies(c.Writer)
	apiresponse.Message(c, http.StatusOK, "Logged out successfully")
}

func Me(c *gin.Context) {
	if token, err := c.Cookie(session.CookieName); err == nil && token != "" {
		session.RefreshCookiePath(c.Writer, token)
	}
	username, _ := c.Get("username")
	role, _ := c.Get("role")
	userID, _ := c.Get("user_id")
	c.JSON(http.StatusOK, gin.H{"id": userID, "username": username, "role": role})
}

func UpdatePassword(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		apiresponse.Error(c, http.StatusUnauthorized, "unauthorized", "Unauthorized")
		return
	}

	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !bindJSON(c, &input) {
		return
	}

	var user models.User
	err := config.DB.First(&user, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "user_not_found", "User not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load user")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		apiresponse.Error(c, http.StatusForbidden, "incorrect_password", "Incorrect current password")
		return
	}
	if input.CurrentPassword == input.NewPassword {
		apiresponse.Error(c, http.StatusBadRequest, "password_reused", "New password must be different from the current password")
		return
	}
	if err := security.ValidatePassword(input.NewPassword, user.Username); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_password", err.Error())
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		observability.FromGin(c).ErrorContext(c.Request.Context(), "password hashing failed", "error", err)
		apiresponse.Error(c, http.StatusInternalServerError, "password_error", "Failed to hash password")
		return
	}
	result := config.DB.Model(&user).Updates(map[string]interface{}{
		"password_hash":   string(newHash),
		"session_version": gorm.Expr("session_version + 1"),
	})
	if result.Error != nil || result.RowsAffected == 0 {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Failed to update password")
		return
	}
	session.ClearCookies(c.Writer)
	apiresponse.Message(c, http.StatusOK, "Password updated; please sign in again")
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
