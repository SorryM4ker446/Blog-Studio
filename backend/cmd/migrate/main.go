package main

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"blog-backend/internal/migrations"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	if len(os.Args) != 2 || os.Args[1] != "up" {
		log.Fatal("Usage: go run ./cmd/migrate up")
	}
	dsn := strings.TrimSpace(os.Getenv("DB_DSN"))
	if dsn == "" {
		log.Fatal("DB_DSN is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		log.Fatalf("Open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("Access database connection: %v", err)
	}
	defer func() {
		if closeErr := sqlDB.Close(); closeErr != nil {
			log.Printf("Close database: %v", closeErr)
		}
	}()
	if err := sqlDB.PingContext(ctx); err != nil {
		log.Fatalf("Connect to database: %v", err)
	}
	if err := migrations.Apply(ctx, db); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			log.Fatal("Database migration timed out while waiting for the migration lock or applying changes")
		}
		log.Fatalf("Apply database migrations: %v", err)
	}
	if err := migrations.VerifyCurrent(ctx, db); err != nil {
		log.Fatalf("Verify database migrations: %v", err)
	}
	log.Printf("Database schema is current at version %d.", migrations.CurrentVersion())
}
