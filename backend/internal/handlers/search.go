package handlers

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
)

var (
	markdownImageRegex = regexp.MustCompile(`!\[[^\]]*\]\([^)]+\)`)
	markdownLinkRegex  = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
	urlRegex           = regexp.MustCompile(`https?://[^\s)]+`)
)

func respondWithSearchResults(c *gin.Context, includeDrafts bool, includeSystem bool) {
	query, ok := validateSearchQuery(c)
	if !ok {
		return
	}
	scope := strings.TrimSpace(c.Query("scope"))
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "posts" && scope != "files" {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_scope", "scope must be posts, files, or all")
		return
	}

	normalizedQuery := strings.ToLower(query)
	likeQuery := "%" + escapeLikePattern(query) + "%"
	var posts []models.Post
	var files []models.File
	if scope == "all" || scope == "posts" {
		db := config.DB.Joins("LEFT JOIN categories ON categories.id = posts.category_id").Preload("Category")
		if !includeDrafts {
			db = db.Where("posts.status = ?", "published")
		}
		db = db.Where(`(posts.title ILIKE ? ESCAPE E'\\' OR posts.summary ILIKE ? ESCAPE E'\\' OR posts.content ILIKE ? ESCAPE E'\\' OR categories.name ILIKE ? ESCAPE E'\\')`, likeQuery, likeQuery, likeQuery, likeQuery)
		if includeDrafts {
			db = db.Order("posts.updated_at DESC, posts.id DESC")
		} else {
			db = db.Order("COALESCE(posts.last_edited_at, posts.published_at) DESC, posts.id DESC")
		}
		err := db.Find(&posts).Error
		if err != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not search posts")
			return
		}
		posts = filterPostsByVisibleText(posts, normalizedQuery)
	}
	if scope == "all" || scope == "files" {
		db := config.DB.Where(`orig_name ILIKE ? ESCAPE E'\\'`, likeQuery)
		if !includeSystem {
			db = db.Where("is_system IS NOT TRUE")
		}
		if err := db.Order("created_at DESC, id DESC").Find(&files).Error; err != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not search files")
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"posts": posts, "files": files})
}

func filterPostsByVisibleText(posts []models.Post, normalizedQuery string) []models.Post {
	filtered := make([]models.Post, 0, len(posts))
	for _, post := range posts {
		categoryName := ""
		if post.Category != nil {
			categoryName = post.Category.Name
		}
		if strings.Contains(strings.ToLower(post.Title), normalizedQuery) ||
			strings.Contains(strings.ToLower(post.Summary), normalizedQuery) ||
			strings.Contains(strings.ToLower(categoryName), normalizedQuery) ||
			strings.Contains(strings.ToLower(extractSearchableContent(post.Content)), normalizedQuery) {
			filtered = append(filtered, post)
		}
	}
	return filtered
}

func extractSearchableContent(markdown string) string {
	content := markdownImageRegex.ReplaceAllString(markdown, " ")
	content = markdownLinkRegex.ReplaceAllString(content, "$1")
	return urlRegex.ReplaceAllString(content, " ")
}

func escapeLikePattern(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}

func SearchResources(c *gin.Context) {
	respondWithSearchResults(c, false, false)
}

func AdminSearchResources(c *gin.Context) {
	includeSystem, err := strconv.ParseBool(c.DefaultQuery("include_system", "true"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_include_system", "include_system must be true or false")
		return
	}
	respondWithSearchResults(c, true, includeSystem)
}
