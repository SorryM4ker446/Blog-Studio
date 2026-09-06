package migrations

import (
	"errors"
	"fmt"

	"blog-backend/internal/searchtext"
	"gorm.io/gorm"
)

func addArticleSearch(tx *gorm.DB) error {
	var ready bool
	if err := tx.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
		WHERE e.extname='pg_trgm' AND n.nspname='public'
	) AND has_schema_privilege(current_user, 'public', 'USAGE')`).Scan(&ready).Error; err != nil {
		return errors.New("could not inspect the pg_trgm prerequisite")
	}
	if !ready {
		return errors.New("pg_trgm must be installed by an operator in schema public, with USAGE granted to the migration role; see docs/deployment.md")
	}
	if err := tx.Exec(`ALTER TABLE posts ADD COLUMN search_text TEXT`).Error; err != nil {
		return fmt.Errorf("add article search text: %w", err)
	}
	var lastID uint
	for {
		var rows []struct {
			ID      uint
			Content string
		}
		if err := tx.Table("posts").Select("id, content").Where("id > ?", lastID).Order("id").Limit(64).Scan(&rows).Error; err != nil {
			return fmt.Errorf("read articles for search backfill: %w", err)
		}
		if len(rows) == 0 {
			break
		}
		for _, row := range rows {
			if err := tx.Exec(`UPDATE posts SET search_text = ? WHERE id = ?`, searchtext.Extract(row.Content), row.ID).Error; err != nil {
				return fmt.Errorf("backfill article search text: %w", err)
			}
			lastID = row.ID
		}
	}
	for _, sql := range []string{
		`ALTER TABLE posts ALTER COLUMN search_text SET NOT NULL`,
		`CREATE INDEX idx_posts_search_text ON posts USING gin (search_text public.gin_trgm_ops) WITH (fastupdate=off)`,
		`CREATE INDEX idx_posts_admin_order ON posts ((CASE WHEN status = 'draft' THEN 1 ELSE 2 END), updated_at DESC, id DESC)`,
		`CREATE INDEX idx_files_public_order ON files (created_at DESC, id DESC) WHERE is_system IS NOT TRUE`,
	} {
		if err := tx.Exec(sql).Error; err != nil {
			return fmt.Errorf("establish search indexes: %w", err)
		}
	}
	return nil
}
