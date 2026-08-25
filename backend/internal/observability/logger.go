package observability

import (
	"context"
	"io"
	"log/slog"
	"strings"

	"github.com/gin-gonic/gin"
)

const requestLoggerKey = "request_logger"

type contextKey string

const loggerContextKey contextKey = "blog_studio_logger"

func NewLogger(environment string, writer io.Writer) *slog.Logger {
	options := &slog.HandlerOptions{
		Level:       slog.LevelInfo,
		ReplaceAttr: redactSensitiveAttribute,
	}
	if environment == "production" {
		return slog.New(slog.NewJSONHandler(writer, options))
	}
	return slog.New(slog.NewTextHandler(writer, options))
}

func redactSensitiveAttribute(_ []string, attribute slog.Attr) slog.Attr {
	key := strings.ToLower(attribute.Key)
	for _, fragment := range []string{"authorization", "cookie", "csrf", "dsn", "password", "secret", "token"} {
		if strings.Contains(key, fragment) {
			return slog.String(attribute.Key, "[REDACTED]")
		}
	}
	return attribute
}

func withLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerContextKey, logger)
}

func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerContextKey).(*slog.Logger); ok && logger != nil {
		return logger
	}
	return slog.Default()
}

func FromGin(c *gin.Context) *slog.Logger {
	if logger, ok := c.Get(requestLoggerKey); ok {
		if requestLogger, valid := logger.(*slog.Logger); valid && requestLogger != nil {
			return requestLogger
		}
	}
	return FromContext(c.Request.Context())
}
