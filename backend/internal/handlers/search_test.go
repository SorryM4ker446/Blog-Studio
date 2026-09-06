package handlers

import (
	"strings"
	"testing"

	"blog-backend/internal/models"
)

func TestSearchVisibleArticleText(t *testing.T) {
	markdown := "Visible paragraph\n![private-image-name](https://example.invalid/image-target)\nRead [the public guide](https://example.invalid/link-target)\nhttps://example.invalid/bare-target"
	visible := extractSearchableContent(markdown)
	for _, term := range []string{"Visible paragraph", "the public guide"} {
		if !strings.Contains(visible, term) {
			t.Fatalf("lost visible text %q", term)
		}
	}
	for _, term := range []string{"private-image-name", "image-target", "link-target", "bare-target"} {
		if strings.Contains(visible, term) {
			t.Fatalf("included hidden text %q", term)
		}
	}
	posts := []models.Post{
		{ID: 1, Title: "Release Notes"},
		{ID: 2, Summary: "Architecture overview"},
		{ID: 3, Category: &models.Category{Name: "Engineering"}},
		{ID: 4, Content: "A visible Tutorial 中文"},
		{ID: 5, Content: markdown},
	}
	for _, test := range []struct {
		term string
		id   uint
	}{
		{"release", 1}, {"architecture", 2}, {"engineering", 3}, {"tutorial", 4}, {"中文", 4}, {"public guide", 5},
	} {
		matches := filterPostsByVisibleText(posts, test.term)
		if len(matches) != 1 || matches[0].ID != test.id {
			t.Fatalf("incorrect visible match for %q", test.term)
		}
	}
	if len(filterPostsByVisibleText(posts, "image-target")) != 0 {
		t.Fatal("matched hidden image URL")
	}
}
