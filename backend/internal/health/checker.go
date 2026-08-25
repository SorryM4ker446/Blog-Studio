package health

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/observability"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Checker struct {
	timeout       time.Duration
	databaseCheck func(context.Context) error
	storageCheck  func() error
	accepting     atomic.Bool
}

func NewChecker(db *gorm.DB, uploadDir string, timeout time.Duration) *Checker {
	checker := newChecker(
		timeout,
		func(ctx context.Context) error {
			if db == nil {
				return errors.New("database is not initialized")
			}
			sqlDB, err := db.DB()
			if err != nil {
				return fmt.Errorf("access database pool: %w", err)
			}
			if err := sqlDB.PingContext(ctx); err != nil {
				return fmt.Errorf("ping database: %w", err)
			}
			return nil
		},
		func() error { return checkWritableDirectory(uploadDir) },
	)
	return checker
}

func newChecker(
	timeout time.Duration,
	databaseCheck func(context.Context) error,
	storageCheck func() error,
) *Checker {
	checker := &Checker{
		timeout:       timeout,
		databaseCheck: databaseCheck,
		storageCheck:  storageCheck,
	}
	checker.accepting.Store(true)
	return checker
}

func (checker *Checker) MarkShuttingDown() {
	checker.accepting.Store(false)
}

func Liveness(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (checker *Checker) Readiness(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !checker.accepting.Load() {
		apiresponse.Error(c, http.StatusServiceUnavailable, "service_shutting_down", "Service is shutting down")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), checker.timeout)
	defer cancel()
	if err := checker.databaseCheck(ctx); err != nil {
		observability.FromGin(c).WarnContext(ctx, "readiness check failed", "component", "database", "error", err)
		apiresponse.Error(c, http.StatusServiceUnavailable, "service_not_ready", "Service is not ready")
		return
	}
	if err := ctx.Err(); err != nil {
		observability.FromGin(c).WarnContext(ctx, "readiness check failed", "component", "database", "error", err)
		apiresponse.Error(c, http.StatusServiceUnavailable, "service_not_ready", "Service is not ready")
		return
	}
	if err := checker.storageCheck(); err != nil {
		observability.FromGin(c).WarnContext(ctx, "readiness check failed", "component", "storage", "error", err)
		apiresponse.Error(c, http.StatusServiceUnavailable, "service_not_ready", "Service is not ready")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}

func checkWritableDirectory(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("inspect upload directory: %w", err)
	}
	if !info.IsDir() {
		return errors.New("upload path is not a directory")
	}

	probeDirectory := filepath.Join(path, ".health")
	if err := os.Mkdir(probeDirectory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("create upload health directory: %w", err)
	}
	probeInfo, err := os.Lstat(probeDirectory)
	if err != nil {
		return fmt.Errorf("inspect upload health directory: %w", err)
	}
	if !probeInfo.IsDir() || probeInfo.Mode()&os.ModeSymlink != 0 {
		return errors.New("upload health path is not a safe directory")
	}

	probe, err := os.CreateTemp(probeDirectory, "readiness-*")
	if err != nil {
		return fmt.Errorf("create upload directory probe: %w", err)
	}
	probePath := probe.Name()
	if err := probe.Close(); err != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("close upload directory probe: %w", err)
	}
	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("remove upload directory probe: %w", err)
	}
	return nil
}
