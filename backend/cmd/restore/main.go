package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"blog-backend/internal/backup"
	"blog-backend/internal/config"
	"blog-backend/internal/migrations"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("Usage: go run ./cmd/restore <backup-bundle>")
	}
	targetDatabaseDSN, err := config.ReadEnvironmentValue("RESTORE_DB_DSN")
	if err != nil {
		log.Fatalf("Load restore database configuration: %v", err)
	}
	targetDatabaseDSN = strings.TrimSpace(targetDatabaseDSN)
	if targetDatabaseDSN == "" {
		log.Fatal("RESTORE_DB_DSN or RESTORE_DB_DSN_FILE is required")
	}
	targetUploadDir := strings.TrimSpace(os.Getenv("RESTORE_UPLOAD_DIR"))
	if targetUploadDir == "" {
		log.Fatal("RESTORE_UPLOAD_DIR is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	activeDatabaseDSN := ""
	if strings.TrimSpace(os.Getenv("DB_DSN")) != "" ||
		strings.TrimSpace(os.Getenv("DB_DSN_FILE")) != "" ||
		strings.TrimSpace(os.Getenv("DB_HOST")) != "" {
		activeDatabaseDSN, err = config.DatabaseDSNFromEnv()
		if err != nil {
			log.Fatalf("Load active database configuration: %v", err)
		}
	}
	if err := backup.Restore(ctx, backup.RestoreOptions{
		BundleDir:                os.Args[1],
		TargetDatabaseDSN:        targetDatabaseDSN,
		TargetUploadDir:          targetUploadDir,
		ActiveDatabaseDSN:        activeDatabaseDSN,
		ActiveUploadDir:          strings.TrimSpace(os.Getenv("UPLOAD_DIR")),
		ExpectedMigrationVersion: migrations.CurrentVersion(),
		PgRestorePath:            strings.TrimSpace(os.Getenv("PG_RESTORE_PATH")),
	}); err != nil {
		log.Fatalf("Restore backup into isolated targets: %v", err)
	}
	log.Print("Backup restored and verified in the isolated database and upload directory.")
}
