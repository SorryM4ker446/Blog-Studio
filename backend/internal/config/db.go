package config

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"blog-backend/internal/migrations"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var DB *gorm.DB

type slogDatabaseWriter struct{}

func (slogDatabaseWriter) Printf(format string, args ...any) {
	slog.Warn("database diagnostic", "detail", fmt.Sprintf(format, args...))
}

func InitDB(ctx context.Context) error {
	cfg := Current()

	databaseLogger := gormlogger.New(slogDatabaseWriter{}, gormlogger.Config{
		SlowThreshold:        500 * time.Millisecond,
		LogLevel:             gormlogger.Warn,
		ParameterizedQueries: true,
		Colorful:             false,
	})
	db, err := gorm.Open(postgres.Open(cfg.DatabaseDSN), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   databaseLogger,
	})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("access database connection pool: %w", err)
	}
	sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConnections)
	sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConnections)
	sqlDB.SetConnMaxLifetime(cfg.DBConnectionLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.DBConnectionIdleTime)
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("ping database: %w", err)
	}

	if err := migrations.VerifyCurrent(ctx, db); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("verify database schema: %w", err)
	}

	DB = db
	return nil
}

func CloseDB() error {
	if DB == nil {
		return nil
	}
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("access database connection pool: %w", err)
	}
	if err := sqlDB.Close(); err != nil {
		return fmt.Errorf("close database: %w", err)
	}
	DB = nil
	return nil
}
