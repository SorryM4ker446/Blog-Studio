package migrations

import (
	"context"
	"testing"

	"blog-backend/internal/models"
)

func TestArticleVersionMigrationBackfillRollbackAndTrigger(t *testing.T) {
	db := openIsolatedSchema(t)
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP TRIGGER posts_advance_version ON posts;
		DROP FUNCTION advance_post_version(); ALTER TABLE posts DROP COLUMN version;
		DELETE FROM blog_schema_migrations WHERE version = 2026090901;
		INSERT INTO posts(title,slug,content,search_text,status,created_at,updated_at)
		VALUES ('Historical','historical-version','Original','original','draft','2026-08-01','2026-08-01');
		CREATE FUNCTION advance_post_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := Apply(context.Background(), db); err == nil {
		t.Fatal("expected function collision to roll back migration")
	}
	if db.Migrator().HasColumn("posts", "version") {
		t.Fatal("failed migration retained version column")
	}
	if err := db.Exec("DROP FUNCTION advance_post_version()").Error; err != nil {
		t.Fatal(err)
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var before models.Post
	if err := db.Where("slug = ?", "historical-version").First(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before.Version != 1 || before.Content != "Original" || !before.CreatedAt.Equal(before.UpdatedAt) {
		t.Fatal("historical backfill changed content or timestamps")
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE posts SET summary = ?, version = 99 WHERE id = ?", "Updated", before.ID).Error; err != nil {
		t.Fatal(err)
	}
	var after models.Post
	if err := db.First(&after, before.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Version != 2 || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatal("trigger must advance version exactly once without changing timestamps")
	}
}
