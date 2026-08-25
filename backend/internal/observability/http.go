package observability

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"sync/atomic"
	"time"

	"blog-backend/internal/apiresponse"
	"github.com/gin-gonic/gin"
)

const (
	RequestIDHeader = "X-Request-ID"
	RequestIDKey    = "request_id"
)

var (
	requestIDPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	requestIDFallback atomic.Uint64
)

func RequestMiddleware(baseLogger *slog.Logger) gin.HandlerFunc {
	if baseLogger == nil {
		baseLogger = slog.Default()
	}

	return func(c *gin.Context) {
		requestID := c.GetHeader(RequestIDHeader)
		if !requestIDPattern.MatchString(requestID) {
			requestID = newRequestID()
		}
		c.Set(RequestIDKey, requestID)
		c.Header(RequestIDHeader, requestID)

		logger := baseLogger.With("request_id", requestID)
		c.Set(requestLoggerKey, logger)
		c.Request = c.Request.WithContext(withLogger(c.Request.Context(), logger))

		started := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		attributes := []any{
			"method", c.Request.Method,
			"route", route,
			"status", c.Writer.Status(),
			"duration_ms", float64(time.Since(started).Microseconds()) / 1000,
			"response_bytes", c.Writer.Size(),
			"client_ip", c.ClientIP(),
		}
		switch status := c.Writer.Status(); {
		case status >= http.StatusInternalServerError:
			logger.ErrorContext(c.Request.Context(), "http request completed", attributes...)
		case status >= http.StatusBadRequest:
			logger.WarnContext(c.Request.Context(), "http request completed", attributes...)
		default:
			logger.InfoContext(c.Request.Context(), "http request completed", attributes...)
		}
	}
}

func RecoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				FromGin(c).ErrorContext(
					c.Request.Context(),
					"request panic recovered",
					"panic_type", fmt.Sprintf("%T", recovered),
					"stack", string(debug.Stack()),
				)
				if !c.Writer.Written() {
					apiresponse.AbortError(
						c,
						http.StatusInternalServerError,
						"internal_error",
						"An unexpected server error occurred",
					)
				} else {
					c.Abort()
				}
			}
		}()
		c.Next()
	}
}

func newRequestID() string {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err == nil {
		return hex.EncodeToString(random)
	}
	return fmt.Sprintf("fallback-%d-%d", time.Now().UnixNano(), requestIDFallback.Add(1))
}
