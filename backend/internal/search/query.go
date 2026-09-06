// Package search returns bounded resource pages and totals from one database snapshot.
package search

import (
	"encoding/json"
	"strings"

	"blog-backend/internal/models"
	"gorm.io/gorm"
)

type Options struct {
	Query         string
	Scope         string
	CategoryID    *uint
	Admin         bool
	IncludeSystem bool
	Page          int
	Limit         int
}

type Result struct {
	Posts      []models.PostSummary `json:"posts"`
	Files      []models.File        `json:"files"`
	PostsTotal int64                `json:"posts_total"`
	FilesTotal int64                `json:"files_total"`
	Total      int64                `json:"total"`
	Page       int                  `json:"page"`
	Limit      int                  `json:"limit"`
}

// Query builds the same parameterized SQL used by reads and query-plan checks.
// Callers validate scope/page/limit before calling this function.
func Query(options Options) (string, []any) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(options.Query) + "%"
	like := ` ILIKE ? ESCAPE E'\\'`
	var args []any
	postMatch := `SELECT id FROM posts WHERE FALSE`
	if options.Scope != "files" {
		filter := "TRUE"
		if !options.Admin {
			filter = "p.status='published'"
		}
		if options.CategoryID != nil {
			if *options.CategoryID == 0 {
				filter += " AND p.category_id IS NULL"
			} else {
				filter += " AND p.category_id = ?"
				args = append(args, *options.CategoryID)
			}
		}
		postMatch = `WITH authorized AS NOT MATERIALIZED (SELECT p.id FROM posts p WHERE ` + filter + `),
		metadata_matches AS MATERIALIZED (SELECT p.id FROM posts p JOIN authorized a ON a.id=p.id WHERE p.title` + like + ` OR p.summary` + like + `),
		remaining_posts AS MATERIALIZED (SELECT id FROM authorized WHERE id NOT IN (SELECT id FROM metadata_matches))
		SELECT p.id FROM posts p WHERE EXISTS (SELECT 1 FROM remaining_posts) AND p.search_text` + like + ` AND p.id IN (SELECT id FROM remaining_posts)
		UNION SELECT id FROM metadata_matches
		UNION SELECT p.id FROM posts p JOIN authorized a ON a.id=p.id JOIN categories c ON c.id=p.category_id WHERE c.name` + like
		args = append(args, pattern, pattern, pattern, pattern)
	}
	fileFilter := "FALSE"
	if options.Scope != "posts" {
		fileFilter = `COALESCE(NULLIF(BTRIM(f.display_name), ''), f.orig_name)` + like
		args = append(args, pattern)
		if options.Admin {
			fileFilter = "(" + fileFilter + " OR f.description" + like + ")"
			args = append(args, pattern)
		}
		if !options.Admin || !options.IncludeSystem {
			fileFilter = "(" + fileFilter + ") AND f.is_system IS NOT TRUE"
		}
	}
	timeline := "COALESCE(p.last_edited_at, p.published_at)"
	if options.Admin {
		timeline = "p.updated_at"
	}
	sql := `WITH matches AS MATERIALIZED (
		SELECT 'post' AS kind, p.id, ` + timeline + ` AS sort_time FROM posts p JOIN (` + postMatch + `) hit ON hit.id=p.id
		UNION ALL SELECT 'file' AS kind, f.id, f.created_at AS sort_time FROM files f WHERE ` + fileFilter + `
	), totals AS (SELECT count(*) AS total, count(*) FILTER (WHERE kind='post') AS posts_total, count(*) FILTER (WHERE kind='file') AS files_total FROM matches),
	selected AS MATERIALIZED (SELECT * FROM matches ORDER BY sort_time DESC, kind ASC, id DESC LIMIT ? OFFSET ?),
	post_page AS (
		SELECT p.id, p.title, p.slug, p.summary, p.category_id, p.status, p.published_at, p.last_edited_at, p.created_at, p.updated_at, s.sort_time,
		CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'created_at',c.created_at,'post_count',0) END AS category
		FROM selected s JOIN posts p ON s.kind='post' AND s.id=p.id LEFT JOIN categories c ON c.id=p.category_id
	), file_page AS (
		SELECT f.id, f.orig_name, f.display_name, f.description, f.size, f.mime_type, f.is_system, f.created_at, s.sort_time
		FROM selected s JOIN files f ON s.kind='file' AND s.id=f.id
	)
	SELECT totals.*,
	COALESCE((SELECT jsonb_agg(to_jsonb(p)-'sort_time' ORDER BY sort_time DESC,id DESC) FROM post_page p), '[]'::jsonb) AS posts,
	COALESCE((SELECT jsonb_agg(to_jsonb(f)-'sort_time' ORDER BY sort_time DESC,id DESC) FROM file_page f), '[]'::jsonb) AS files FROM totals`
	return sql, append(args, options.Limit, int64(options.Page-1)*int64(options.Limit))
}

func Read(db *gorm.DB, options Options) (Result, error) {
	sql, args := Query(options)
	var row struct {
		Total, PostsTotal, FilesTotal int64
		Posts, Files                  string
	}
	result := Result{Page: options.Page, Limit: options.Limit}
	if err := db.Raw(sql, args...).Scan(&row).Error; err != nil {
		return result, err
	}
	if err := json.Unmarshal([]byte(row.Posts), &result.Posts); err != nil {
		return result, err
	}
	if err := json.Unmarshal([]byte(row.Files), &result.Files); err != nil {
		return result, err
	}
	result.Total, result.PostsTotal, result.FilesTotal = row.Total, row.PostsTotal, row.FilesTotal
	return result, nil
}
