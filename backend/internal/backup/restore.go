package backup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"blog-backend/internal/migrations"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type RestoreOptions struct {
	BundleDir                string
	TargetDatabaseDSN        string
	TargetUploadDir          string
	ActiveDatabaseDSN        string
	ActiveUploadDir          string
	ExpectedMigrationVersion int64
	PgRestorePath            string
	Runner                   CommandRunner
}

func Restore(ctx context.Context, options RestoreOptions) error {
	if strings.TrimSpace(options.BundleDir) == "" {
		return errors.New("backup bundle is required")
	}
	if strings.TrimSpace(options.TargetDatabaseDSN) == "" {
		return errors.New("restore database DSN is required")
	}
	if strings.TrimSpace(options.TargetUploadDir) == "" {
		return errors.New("restore upload directory is required")
	}
	if options.ExpectedMigrationVersion <= 0 {
		return errors.New("expected migration version is required")
	}
	if options.PgRestorePath == "" {
		options.PgRestorePath = "pg_restore"
	}
	if options.Runner == nil {
		options.Runner = ExecRunner{}
	}

	manifest, err := Verify(options.BundleDir)
	if err != nil {
		return err
	}
	if manifest.MigrationVersion != options.ExpectedMigrationVersion {
		return fmt.Errorf(
			"backup migration version is %d, expected %d",
			manifest.MigrationVersion,
			options.ExpectedMigrationVersion,
		)
	}
	if err := validateRestoreDatabase(options.TargetDatabaseDSN, options.ActiveDatabaseDSN); err != nil {
		return err
	}
	targetUploadDir, err := validateRestoreUploadDir(options.TargetUploadDir, options.ActiveUploadDir)
	if err != nil {
		return err
	}
	if err := VerifyDatabaseArchive(ctx, options.BundleDir, options.PgRestorePath, options.Runner); err != nil {
		return err
	}

	db, sqlDB, err := openRestoreDatabase(ctx, options.TargetDatabaseDSN)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	var tableCount int64
	if err := db.WithContext(ctx).Raw(`
		SELECT COUNT(*)
		FROM information_schema.tables
		WHERE table_schema = current_schema()
		  AND table_type = 'BASE TABLE'
	`).Scan(&tableCount).Error; err != nil {
		return fmt.Errorf("inspect restore database: %w", err)
	}
	if tableCount != 0 {
		return fmt.Errorf("restore database is not empty: found %d tables", tableCount)
	}

	parentDir := filepath.Dir(targetUploadDir)
	if err := os.MkdirAll(parentDir, 0o700); err != nil {
		return fmt.Errorf("create restore upload parent: %w", err)
	}
	stagingDir, err := os.MkdirTemp(parentDir, ".blog-studio-restore-")
	if err != nil {
		return fmt.Errorf("create restore upload staging directory: %w", err)
	}
	keepStaging := false
	defer func() {
		if !keepStaging {
			_ = os.RemoveAll(stagingDir)
		}
	}()
	uploadArchive := filepath.Join(options.BundleDir, manifest.Uploads.File)
	fileCount, uncompressedSize, err := inspectUploadArchive(uploadArchive, &stagingDir)
	if err != nil {
		return fmt.Errorf("extract uploads archive: %w", err)
	}
	if fileCount != manifest.Uploads.FileCount || uncompressedSize != manifest.Uploads.UncompressedSize {
		return errors.New("extracted uploads do not match the backup manifest")
	}

	databaseArchive := filepath.Join(options.BundleDir, manifest.Database.File)
	targetConfig, err := pgx.ParseConfig(options.TargetDatabaseDSN)
	if err != nil {
		return fmt.Errorf("parse RESTORE_DB_DSN: %w", err)
	}
	restoreArgs := []string{
		"--exit-on-error",
		"--single-transaction",
		"--no-owner",
		"--no-privileges",
		"--no-password",
		"--dbname=" + targetConfig.Database,
		databaseArchive,
	}
	postgresEnv, err := postgresEnvironment(options.TargetDatabaseDSN)
	if err != nil {
		return err
	}
	if err := options.Runner.Run(ctx, options.PgRestorePath, restoreArgs, postgresEnv); err != nil {
		return fmt.Errorf("restore PostgreSQL archive: %w", err)
	}
	if err := migrations.VerifyCurrent(ctx, db); err != nil {
		return fmt.Errorf("verify restored database schema: %w", err)
	}
	if err := os.Rename(stagingDir, targetUploadDir); err != nil {
		return fmt.Errorf("publish restored uploads: %w", err)
	}
	keepStaging = true
	report, err := CheckStorageConsistency(db.WithContext(ctx), targetUploadDir)
	if err != nil {
		return fmt.Errorf("verify restored storage: %w", err)
	}
	if err := report.Error(); err != nil {
		return fmt.Errorf("verify restored storage: %w", err)
	}
	return nil
}

func validateRestoreDatabase(targetDSN, activeDSN string) error {
	target, err := pgx.ParseConfig(targetDSN)
	if err != nil {
		return fmt.Errorf("parse RESTORE_DB_DSN: %w", err)
	}
	if !strings.HasSuffix(strings.ToLower(target.Database), "_restore") {
		return fmt.Errorf("restore database name %q must end in _restore", target.Database)
	}
	if strings.TrimSpace(activeDSN) == "" {
		return nil
	}
	active, err := pgx.ParseConfig(activeDSN)
	if err != nil {
		return fmt.Errorf("parse active DB_DSN: %w", err)
	}
	if strings.EqualFold(target.Host, active.Host) && target.Port == active.Port && strings.EqualFold(target.Database, active.Database) {
		return errors.New("restore database must differ from the active database")
	}
	return nil
}

func validateRestoreUploadDir(target, active string) (string, error) {
	target, err := filepath.Abs(strings.TrimSpace(target))
	if err != nil {
		return "", fmt.Errorf("resolve restore upload directory: %w", err)
	}
	volumeRoot := filepath.Clean(filepath.VolumeName(target) + string(filepath.Separator))
	if filepath.Clean(target) == volumeRoot {
		return "", errors.New("restore upload directory must not be a filesystem root")
	}
	if _, err := os.Lstat(target); err == nil {
		return "", errors.New("restore upload directory must not already exist")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect restore upload directory: %w", err)
	}
	if strings.TrimSpace(active) != "" {
		active, err = filepath.Abs(strings.TrimSpace(active))
		if err != nil {
			return "", fmt.Errorf("resolve active upload directory: %w", err)
		}
		if strings.EqualFold(filepath.Clean(target), filepath.Clean(active)) {
			return "", errors.New("restore upload directory must differ from the active upload directory")
		}
	}
	return filepath.Clean(target), nil
}

func openRestoreDatabase(ctx context.Context, dsn string) (*gorm.DB, *sql.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("open restore database: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, nil, fmt.Errorf("access restore database connection: %w", err)
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, nil, fmt.Errorf("connect to restore database: %w", err)
	}
	return db, sqlDB, nil
}
