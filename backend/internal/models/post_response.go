package models

import "time"

// PostSummary is the body-free representation used by article collections.
type PostSummary struct {
	ID           uint       `json:"id"`
	Title        string     `json:"title"`
	Slug         string     `json:"slug"`
	Summary      string     `json:"summary"`
	CategoryID   *uint      `json:"category_id"`
	Category     *Category  `json:"category"`
	Status       string     `json:"status"`
	PublishedAt  *time.Time `json:"published_at"`
	LastEditedAt *time.Time `json:"last_edited_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PostDetail struct {
	PostSummary
	Content string `json:"content"`
}

func SummarizePost(post Post) PostSummary {
	return PostSummary{
		ID: post.ID, Title: post.Title, Slug: post.Slug, Summary: post.Summary,
		CategoryID: post.CategoryID, Category: post.Category, Status: post.Status,
		PublishedAt: post.PublishedAt, LastEditedAt: post.LastEditedAt,
		CreatedAt: post.CreatedAt, UpdatedAt: post.UpdatedAt,
	}
}

func SummarizePosts(posts []Post) []PostSummary {
	summaries := make([]PostSummary, len(posts))
	for i, post := range posts {
		summaries[i] = SummarizePost(post)
	}
	return summaries
}

func DetailPost(post Post) PostDetail {
	return PostDetail{PostSummary: SummarizePost(post), Content: post.Content}
}
