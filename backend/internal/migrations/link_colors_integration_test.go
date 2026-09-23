package migrations

import (
	"context"
	"testing"
)

func TestCustomLinkColorsUpgradePreservesExistingLinks(t *testing.T) {
	db := openIsolatedSchema(t)
	// Construct the preceding release's schema and history, then run the real upgrader.
	if err := db.Exec(`CREATE TABLE blog_schema_migrations (version BIGINT PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).Error; err != nil {
		t.Fatal(err)
	}
	for _, item := range registered[:len(registered)-1] {
		if err := item.up(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(`INSERT INTO blog_schema_migrations(version,name) VALUES (?,?)`, item.version, item.name).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`UPDATE links SET color = '#123abc'`).Error; err == nil {
		t.Fatal("old schema accepted custom color")
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Table("links").Where("color IN ('blue','yellow','green','red')").Count(&count)
	if count != 4 {
		t.Fatalf("preserved templates = %d", count)
	}
	for _, color := range []string{"#123abc", "#ABCDEF", "#000000", "#ffffff", "blue"} {
		if err := db.Exec(`UPDATE links SET color = ?`, color).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, color := range []string{"#123", "#12345678", "#gggggg", "purple", "var(--accent-blue)", "#123456\n"} {
		if err := db.Exec(`UPDATE links SET color = ?`, color).Error; err == nil {
			t.Fatalf("accepted invalid color %q", color)
		}
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
}
