package migrations

import "gorm.io/gorm"

func addPostVersions(tx *gorm.DB) error {
	return tx.Exec(`
		ALTER TABLE posts ADD COLUMN version BIGINT NOT NULL DEFAULT 1
			CONSTRAINT posts_version_valid CHECK (version BETWEEN 1 AND 9007199254740991);
		CREATE FUNCTION advance_post_version() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			NEW.version := OLD.version + 1;
			RETURN NEW;
		END;
		$$;
		CREATE TRIGGER posts_advance_version BEFORE UPDATE ON posts
			FOR EACH ROW EXECUTE FUNCTION advance_post_version();
	`).Error
}
