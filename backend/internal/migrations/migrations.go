package migrations

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"
)

const (
	migrationTable = "blog_schema_migrations"
	advisoryLockID = int64(718846219540917061)
)

var ErrDatabaseNotCurrent = errors.New("database schema is not current")

type migration struct {
	version int64
	name    string
	up      func(*gorm.DB) error
}

type appliedMigration struct {
	Version int64
	Name    string
}

var registered = []migration{
	{
		version: 2026082601,
		name:    "establish_application_schema",
		up:      establishApplicationSchema,
	},
}

// Apply serializes migration processes with a PostgreSQL transaction-level
// advisory lock, applies every pending migration, and records each version in
// the same transaction as its schema changes.
func Apply(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if err := validateRegistered(); err != nil {
		return err
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(?)`, advisoryLockID).Error; err != nil {
			return fmt.Errorf("acquire migration lock: %w", err)
		}
		if err := tx.Exec(`
			CREATE TABLE IF NOT EXISTS blog_schema_migrations (
				version BIGINT PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`).Error; err != nil {
			return fmt.Errorf("create migration history: %w", err)
		}

		applied, err := loadApplied(tx)
		if err != nil {
			return err
		}
		known := make(map[int64]migration, len(registered))
		for _, item := range registered {
			known[item.version] = item
		}
		for version, name := range applied {
			item, exists := known[version]
			if !exists {
				return fmt.Errorf("database contains unknown migration version %d; use a compatible backend release", version)
			}
			if item.name != name {
				return fmt.Errorf("migration version %d is recorded as %q, expected %q", version, name, item.name)
			}
		}

		for _, item := range registered {
			if _, exists := applied[item.version]; exists {
				continue
			}
			if err := item.up(tx); err != nil {
				return fmt.Errorf("apply migration %d (%s): %w", item.version, item.name, err)
			}
			if err := tx.Exec(
				`INSERT INTO blog_schema_migrations (version, name) VALUES (?, ?)`,
				item.version,
				item.name,
			).Error; err != nil {
				return fmt.Errorf("record migration %d: %w", item.version, err)
			}
		}
		return nil
	})
}

// VerifyCurrent checks migration history without changing the database.
func VerifyCurrent(ctx context.Context, db *gorm.DB) error {
	if db == nil {
		return errors.New("database connection is required")
	}
	if err := validateRegistered(); err != nil {
		return err
	}

	var exists bool
	if err := db.WithContext(ctx).Raw(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = current_schema()
			  AND table_name = ?
		)
	`, migrationTable).Scan(&exists).Error; err != nil {
		return fmt.Errorf("inspect migration history: %w", err)
	}
	if !exists {
		return fmt.Errorf("%w: run `go run ./cmd/migrate up`", ErrDatabaseNotCurrent)
	}

	applied, err := loadApplied(db.WithContext(ctx))
	if err != nil {
		return err
	}
	known := make(map[int64]migration, len(registered))
	for _, item := range registered {
		known[item.version] = item
	}
	for version, name := range applied {
		item, exists := known[version]
		if !exists {
			return fmt.Errorf("database contains unknown migration version %d; use a compatible backend release", version)
		}
		if item.name != name {
			return fmt.Errorf("migration version %d is recorded as %q, expected %q", version, name, item.name)
		}
	}
	if len(applied) != len(registered) {
		return fmt.Errorf("%w: applied %d of %d migrations; run `go run ./cmd/migrate up`", ErrDatabaseNotCurrent, len(applied), len(registered))
	}
	for _, item := range registered {
		_, ok := applied[item.version]
		if !ok {
			return fmt.Errorf("%w: migration %d is pending; run `go run ./cmd/migrate up`", ErrDatabaseNotCurrent, item.version)
		}
	}
	return nil
}

func CurrentVersion() int64 {
	return registered[len(registered)-1].version
}

func loadApplied(db *gorm.DB) (map[int64]string, error) {
	var rows []appliedMigration
	if err := db.Table(migrationTable).Order("version ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load migration history: %w", err)
	}
	applied := make(map[int64]string, len(rows))
	for _, row := range rows {
		applied[row.Version] = row.Name
	}
	return applied, nil
}

func validateRegistered() error {
	if len(registered) == 0 {
		return errors.New("no database migrations are registered")
	}
	versions := make([]int64, 0, len(registered))
	seenNames := make(map[string]struct{}, len(registered))
	for _, item := range registered {
		if item.version <= 0 || item.name == "" || item.up == nil {
			return errors.New("database migration registration is invalid")
		}
		versions = append(versions, item.version)
		if _, exists := seenNames[item.name]; exists {
			return fmt.Errorf("database migration name %q is duplicated", item.name)
		}
		seenNames[item.name] = struct{}{}
	}
	if !sort.SliceIsSorted(versions, func(i, j int) bool { return versions[i] < versions[j] }) {
		return errors.New("database migrations must be registered in ascending version order")
	}
	for index := 1; index < len(versions); index++ {
		if versions[index] == versions[index-1] {
			return fmt.Errorf("database migration version %d is duplicated", versions[index])
		}
	}
	return nil
}
