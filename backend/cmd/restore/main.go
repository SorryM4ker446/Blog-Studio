package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"blog-backend/internal/backup"
	"blog-backend/internal/migrations"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("Usage: go run ./cmd/restore <backup-bundle>")
	}
	targetDatabaseDSN := strings.TrimSpace(os.Getenv("RESTORE_DB_DSN"))
	if targetDatabaseDSN == "" {
		log.Fatal("RESTORE_DB_DSN is required")
	}
	targetUploadDir := strings.TrimSpace(os.Getenv("RESTORE_UPLOAD_DIR"))
	if targetUploadDir == "" {
		log.Fatal("RESTORE_UPLOAD_DIR is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if err := backup.Restore(ctx, backup.RestoreOptions{
		BundleDir:                os.Args[1],
		TargetDatabaseDSN:        targetDatabaseDSN,
		TargetUploadDir:          targetUploadDir,
		ActiveDatabaseDSN:        strings.TrimSpace(os.Getenv("DB_DSN")),
		ActiveUploadDir:          strings.TrimSpace(os.Getenv("UPLOAD_DIR")),
		ExpectedMigrationVersion: migrations.CurrentVersion(),
		PgRestorePath:            strings.TrimSpace(os.Getenv("PG_RESTORE_PATH")),
	}); err != nil {
		log.Fatalf("Restore backup into isolated targets: %v", err)
	}
	log.Print("Backup restored and verified in the isolated database and upload directory.")
}
