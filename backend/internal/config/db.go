package config

import (
	"fmt"
	"log"

	"blog-backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() {
	dsn := Current().DatabaseDSN

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	if err := Migrate(db); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	DB = db
	log.Println("Database connection established and migration completed.")
}

// Migrate upgrades the schema and normalizes legacy rows before adding the
// constraints that enforce the same domain rules as the API.
func Migrate(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Normalize columns that are becoming NOT NULL before AutoMigrate tries
		// to strengthen them. These guards also keep first-time setup working.
		if tx.Migrator().HasTable(&models.User{}) && tx.Migrator().HasColumn(&models.User{}, "Role") {
			if err := tx.Exec(`UPDATE users SET role = 'writer' WHERE role IS NULL`).Error; err != nil {
				return fmt.Errorf("normalize legacy user roles: %w", err)
			}
		}
		if tx.Migrator().HasTable(&models.Post{}) && tx.Migrator().HasColumn(&models.Post{}, "Status") {
			if err := tx.Exec(`UPDATE posts SET status = 'draft' WHERE status IS NULL OR status NOT IN ('draft', 'published')`).Error; err != nil {
				return fmt.Errorf("normalize legacy post statuses: %w", err)
			}
		}
		if tx.Migrator().HasTable(&models.File{}) {
			if tx.Migrator().HasColumn(&models.File{}, "Size") {
				if err := tx.Exec(`UPDATE files SET size = 0 WHERE size IS NULL`).Error; err != nil {
					return fmt.Errorf("normalize legacy file sizes: %w", err)
				}
			}
			if tx.Migrator().HasColumn(&models.File{}, "IsSystem") {
				if err := tx.Exec(`UPDATE files SET is_system = FALSE WHERE is_system IS NULL`).Error; err != nil {
					return fmt.Errorf("normalize legacy system file flags: %w", err)
				}
			}
		}

		if err := tx.AutoMigrate(
			&models.User{},
			&models.Category{},
			&models.Post{},
			&models.File{},
			&models.Setting{},
		); err != nil {
			return fmt.Errorf("auto migrate models: %w", err)
		}

		statements := []string{
			`UPDATE posts SET category_id = NULL
			 WHERE category_id = 0
			    OR NOT EXISTS (SELECT 1 FROM categories WHERE categories.id = posts.category_id)`,
			`UPDATE posts SET status = 'draft', published_at = NULL
			 WHERE status IS NULL OR status NOT IN ('draft', 'published')`,
			`UPDATE posts SET published_at = COALESCE(updated_at, created_at, NOW())
			 WHERE status = 'published' AND published_at IS NULL`,
			`UPDATE files SET display_name = orig_name
			 WHERE display_name IS NULL OR btrim(display_name) = ''`,
		}
		for _, statement := range statements {
			if err := tx.Exec(statement).Error; err != nil {
				return fmt.Errorf("normalize legacy data: %w", err)
			}
		}

		if !tx.Migrator().HasConstraint(&models.Post{}, "Category") {
			if err := tx.Migrator().CreateConstraint(&models.Post{}, "Category"); err != nil {
				return fmt.Errorf("create post category foreign key: %w", err)
			}
		}

		// The previous draft constraint cleared publication history. Replace it
		// with constraints that preserve the first publication timestamp.
		if tx.Migrator().HasConstraint("posts", "chk_posts_published_at") {
			if err := tx.Migrator().DropConstraint("posts", "chk_posts_published_at"); err != nil {
				return fmt.Errorf("replace legacy publication timestamp constraint: %w", err)
			}
		}

		constraints := []struct {
			name       string
			table      string
			definition string
		}{
			{"chk_users_role", "users", `role IN ('admin', 'writer')`},
			{"chk_users_session_version", "users", `session_version >= 1`},
			{"chk_categories_name_not_blank", "categories", `btrim(name) <> ''`},
			{"chk_posts_title_not_blank", "posts", `btrim(title) <> ''`},
			{"chk_posts_content_not_blank", "posts", `btrim(content) <> ''`},
			{"chk_posts_slug_not_blank", "posts", `btrim(slug) <> ''`},
			{"chk_posts_status", "posts", `status IN ('draft', 'published')`},
			{"chk_posts_publication_timestamp", "posts", `status <> 'published' OR published_at IS NOT NULL`},
			{"chk_posts_last_edited_at", "posts", `last_edited_at IS NULL OR (published_at IS NOT NULL AND last_edited_at >= published_at)`},
			{"chk_files_size_nonnegative", "files", `size >= 0`},
			{"chk_files_display_name_not_blank", "files", `btrim(display_name) <> ''`},
			{"chk_settings_key_not_blank", "settings", `btrim(key) <> ''`},
		}
		for _, constraint := range constraints {
			if tx.Migrator().HasConstraint(constraint.table, constraint.name) {
				continue
			}
			statement := fmt.Sprintf(
				"ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)",
				constraint.table,
				constraint.name,
				constraint.definition,
			)
			if err := tx.Exec(statement).Error; err != nil {
				return fmt.Errorf("create constraint %s: %w", constraint.name, err)
			}
		}

		if err := tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_name_ci ON categories (lower(btrim(name)))`).Error; err != nil {
			return fmt.Errorf("create normalized category name index: %w", err)
		}
		if err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_posts_public_timeline ON posts (status, (COALESCE(last_edited_at, published_at)) DESC, id DESC)`).Error; err != nil {
			return fmt.Errorf("create public post timeline index: %w", err)
		}
		return nil
	})
}
