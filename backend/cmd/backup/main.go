package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"blog-backend/internal/backup"
	"blog-backend/internal/migrations"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	if len(os.Args) != 3 || (os.Args[1] != "create" && os.Args[1] != "verify") {
		log.Fatal("Usage: go run ./cmd/backup create <output-directory> | verify <backup-bundle>")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if os.Args[1] == "verify" {
		if _, err := backup.Verify(os.Args[2]); err != nil {
			log.Fatalf("Verify backup checksums: %v", err)
		}
		if err := backup.VerifyDatabaseArchive(ctx, os.Args[2], strings.TrimSpace(os.Getenv("PG_RESTORE_PATH")), nil); err != nil {
			log.Fatalf("Verify database archive: %v", err)
		}
		log.Print("Backup bundle verification passed.")
		return
	}

	dsn := strings.TrimSpace(os.Getenv("DB_DSN"))
	if dsn == "" {
		log.Fatal("DB_DSN is required")
	}
	uploadDir := strings.TrimSpace(os.Getenv("UPLOAD_DIR"))
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	db, closeDatabase, err := openDatabase(ctx, dsn)
	if err != nil {
		log.Fatalf("Open database: %v", err)
	}
	defer closeDatabase()
	if err := migrations.VerifyCurrent(ctx, db); err != nil {
		log.Fatalf("Verify database schema: %v", err)
	}
	report, err := backup.CheckStorageConsistency(db.WithContext(ctx), uploadDir)
	if err != nil {
		log.Fatalf("Check database and upload consistency: %v", err)
	}
	if err := report.Error(); err != nil {
		log.Fatalf("Refusing to back up inconsistent storage: %v", err)
	}

	bundleDir, err := backup.Create(ctx, backup.CreateOptions{
		DatabaseDSN:      dsn,
		UploadDir:        uploadDir,
		OutputDir:        os.Args[2],
		MigrationVersion: migrations.CurrentVersion(),
		PgDumpPath:       strings.TrimSpace(os.Getenv("PG_DUMP_PATH")),
	})
	if err != nil {
		log.Fatalf("Create backup bundle: %v", err)
	}
	if err := backup.VerifyDatabaseArchive(ctx, bundleDir, strings.TrimSpace(os.Getenv("PG_RESTORE_PATH")), nil); err != nil {
		log.Fatalf("Verify created database archive: %v", err)
	}
	log.Printf("Backup bundle created and verified at %s.", bundleDir)
}

func openDatabase(ctx context.Context, dsn string) (*gorm.DB, func(), error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, nil, err
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, nil, err
	}
	return db, func() {
		if err := sqlDB.Close(); err != nil {
			log.Printf("Close database: %v", err)
		}
	}, nil
}
