package migrations

import (
	"blog-backend/internal/models"
	"context"
	"testing"
)

func TestHomepageLinksMigrationPreservesHiddenTemplatesOnce(t *testing.T) {
	db := openIsolatedSchema(t)
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var links []models.Link
	if err := db.Order("position").Find(&links).Error; err != nil {
		t.Fatal(err)
	}
	if len(links) != 4 {
		t.Fatalf("templates: %d", len(links))
	}
	for _, link := range links {
		if link.Visible || link.URL != "" || link.Version != 1 {
			t.Fatal("template has a destination or is public")
		}
	}
	if err := db.Delete(&links[0]).Error; err != nil {
		t.Fatal(err)
	}
	if err := Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&models.Link{}).Count(&count)
	if count != 3 {
		t.Fatal("repeated migration recreated deleted template")
	}
}
