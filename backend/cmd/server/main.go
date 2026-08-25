package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"blog-backend/internal/config"
	"blog-backend/internal/filestore"
	"blog-backend/internal/health"
	"blog-backend/internal/observability"
	"blog-backend/internal/routes"
	"github.com/gin-gonic/gin"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx); err != nil {
		slog.Error("backend stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	logger := observability.NewLogger(cfg.Environment, os.Stdout)
	slog.SetDefault(logger)
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	if err := config.InitDB(ctx); err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer func() {
		if err := config.CloseDB(); err != nil {
			logger.Error("database close failed", "error", err)
		}
	}()
	if _, err := filestore.NewLocalStore(cfg.UploadDir); err != nil {
		return fmt.Errorf("initialize file storage: %w", err)
	}

	healthChecker := health.NewChecker(config.DB, cfg.UploadDir, cfg.HealthCheckTimeout)
	router := routes.SetupRouterWithHealth(healthChecker)
	server := &http.Server{
		Addr:              cfg.ServerAddress,
		Handler:           router,
		ReadHeaderTimeout: cfg.HTTPReadHeaderTimeout,
		ReadTimeout:       cfg.HTTPReadTimeout,
		WriteTimeout:      cfg.HTTPWriteTimeout,
		IdleTimeout:       cfg.HTTPIdleTimeout,
		MaxHeaderBytes:    1 << 20,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("backend listening", "address", cfg.ServerAddress)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		healthChecker.MarkShuttingDown()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-ctx.Done():
		healthChecker.MarkShuttingDown()
		logger.Info("backend shutdown requested")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTPShutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return fmt.Errorf("graceful HTTP shutdown: %w", err)
		}
		if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP during shutdown: %w", err)
		}
		logger.Info("backend shutdown completed")
		return nil
	}
}
