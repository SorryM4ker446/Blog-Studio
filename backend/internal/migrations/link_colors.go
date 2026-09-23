package migrations

import "gorm.io/gorm"

func allowCustomLinkColors(tx *gorm.DB) error {
	return tx.Exec(`ALTER TABLE links DROP CONSTRAINT links_color_check;
		ALTER TABLE links ADD CONSTRAINT links_color_check
		CHECK (color IN ('blue', 'yellow', 'green', 'red') OR color ~ '^#[0-9a-fA-F]{6}$')`).Error
}
