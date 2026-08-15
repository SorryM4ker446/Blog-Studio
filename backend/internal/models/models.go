package models

import (
	"time"
)

type User struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	Username       string    `gorm:"unique;not null;size:50" json:"username"`
	PasswordHash   string    `gorm:"not null" json:"-"`
	Role           string    `gorm:"type:varchar(20);not null;default:'admin'" json:"role"`
	SessionVersion uint      `gorm:"not null;default:1" json:"-"`
	CreatedAt      time.Time `json:"created_at"`
}

type Category struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"unique;not null;size:50" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	PostCount   int64     `gorm:"->;-:migration" json:"post_count"` // Only used for response
	CreatedAt   time.Time `json:"created_at"`
}

type Post struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Title        string     `gorm:"not null;size:255" json:"title"`
	Slug         string     `gorm:"unique;not null;size:255" json:"slug"`
	Summary      string     `gorm:"type:text" json:"summary"`
	Content      string     `gorm:"type:text;not null" json:"content"`
	CategoryID   *uint      `gorm:"index:idx_posts_category_id" json:"category_id"`
	Category     *Category  `gorm:"foreignKey:CategoryID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL" json:"category"`
	Status       string     `gorm:"type:varchar(20);not null;default:'draft';index:idx_posts_status_updated_at,priority:1" json:"status"`
	PublishedAt  *time.Time `json:"published_at"`
	LastEditedAt *time.Time `json:"last_edited_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `gorm:"index:idx_posts_status_updated_at,priority:2,sort:desc" json:"updated_at"`
}

type File struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"not null;size:255;uniqueIndex:ux_files_name" json:"-"`
	OrigName  string    `gorm:"not null;size:255" json:"orig_name"`
	Path      string    `gorm:"not null;size:500" json:"-"`
	Size      int64     `gorm:"not null;default:0" json:"size"`
	MimeType  string    `gorm:"size:100" json:"mime_type"`
	IsSystem  bool      `gorm:"not null;default:false;index:idx_files_system_created_at,priority:1" json:"is_system"`
	CreatedAt time.Time `gorm:"index:idx_files_system_created_at,priority:2,sort:desc" json:"created_at"`
}

type Setting struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"unique;not null;size:100" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
