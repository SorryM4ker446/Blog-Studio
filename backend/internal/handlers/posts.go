package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxSlugRunes = 255

var slugSeparatorRegex = regexp.MustCompile(`[^a-z0-9\x{4e00}-\x{9fa5}]+`)

type createPostInput struct {
	Title      string `json:"title"`
	Slug       string `json:"slug"`
	Summary    string `json:"summary"`
	Content    string `json:"content"`
	CategoryID *uint  `json:"category_id"`
	Status     string `json:"status"`
}

type updatePostInput struct {
	Title      *string `json:"title"`
	Slug       *string `json:"slug"`
	Summary    *string `json:"summary"`
	Content    *string `json:"content"`
	CategoryID *uint   `json:"category_id"`
	Status     *string `json:"status"`
}

func respondWithPosts(c *gin.Context, includeDrafts bool) {
	page, limit, ok := parsePagination(c)
	if !ok {
		return
	}
	categoryID, ok := parseCategoryFilter(c)
	if !ok {
		return
	}
	sortOrder := strings.TrimSpace(c.Query("sort"))
	if sortOrder != "" && sortOrder != "updated" && !(includeDrafts && sortOrder == "admin") {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_sort", "sort must be updated or admin")
		return
	}

	var posts []models.Post
	var total int64
	db := config.DB.Model(&models.Post{})
	if !includeDrafts {
		db = db.Where("status = ?", "published")
	}
	if categoryID != nil {
		if *categoryID == 0 {
			db = db.Where("category_id IS NULL")
		} else {
			db = db.Where("category_id = ?", *categoryID)
		}
	}
	if err := db.Count(&total).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load posts")
		return
	}

	if sortOrder == "admin" {
		db = db.Order("CASE WHEN status = 'draft' THEN 1 ELSE 2 END, updated_at DESC, id DESC")
	} else if includeDrafts {
		db = db.Order("updated_at DESC, id DESC")
	} else {
		db = db.Order("COALESCE(last_edited_at, published_at) DESC, id DESC")
	}
	if err := db.Preload("Category").Limit(limit).Offset(safeOffset(page, limit)).Find(&posts).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load posts")
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": posts, "total": total, "page": page, "limit": limit})
}

func GetPosts(c *gin.Context) {
	respondWithPosts(c, false)
}

func AdminGetPosts(c *gin.Context) {
	respondWithPosts(c, true)
}

func GetPost(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var post models.Post
	err := config.DB.Preload("Category").Where("status = ?", "published").First(&post, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "post_not_found", "Post not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load post")
		return
	}
	c.JSON(http.StatusOK, post)
}

func CreatePost(c *gin.Context) {
	var input createPostInput
	if !bindJSON(c, &input) {
		return
	}
	title, err := normalizeRequired(input.Title, "title", 255)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_title", err.Error())
		return
	}
	content := input.Content
	if strings.TrimSpace(content) == "" {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_content", "content is required")
		return
	}
	if err := validateOptionalLength(content, "content", 1_000_000); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_content", err.Error())
		return
	}
	if err := validateOptionalLength(input.Summary, "summary", 10_000); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_summary", err.Error())
		return
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "draft"
	}
	if err := validatePostStatus(status); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_status", err.Error())
		return
	}

	categoryID := normalizedCategoryID(input.CategoryID)
	category, ok := validateCategory(c, config.DB, categoryID)
	if !ok {
		return
	}

	explicitSlug := strings.TrimSpace(input.Slug) != ""
	baseSlug := slugify(input.Slug)
	if !explicitSlug {
		baseSlug = slugify(title)
	}
	if baseSlug == "" {
		if explicitSlug {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_slug", "slug must contain letters or numbers")
			return
		}
		baseSlug = "post"
	}

	post := models.Post{
		Title: title, Summary: input.Summary, Content: content, CategoryID: categoryID,
		Category: category, Status: status,
	}
	if status == "published" {
		now := time.Now()
		post.PublishedAt = &now
	}
	if err := createPostWithAvailableSlug(&post, baseSlug, explicitSlug); err != nil {
		if isUniqueViolation(err) {
			apiresponse.Error(c, http.StatusConflict, "slug_conflict", "slug is already in use")
		} else if isConstraintViolation(err) {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_post", "Post violates a data constraint")
		} else {
			apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not create post")
		}
		return
	}
	c.JSON(http.StatusCreated, post)
}

func UpdatePost(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input updatePostInput
	if !bindJSON(c, &input) {
		return
	}
	if input.Title == nil && input.Slug == nil && input.Summary == nil && input.Content == nil && input.CategoryID == nil && input.Status == nil {
		apiresponse.Error(c, http.StatusBadRequest, "empty_update", "At least one post field is required")
		return
	}

	var post models.Post
	err := config.DB.First(&post, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "post_not_found", "Post not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load post")
		return
	}

	updates := map[string]any{}
	contentTouched := input.Title != nil || input.Slug != nil || input.Summary != nil || input.Content != nil || input.CategoryID != nil
	if input.Title != nil {
		title, validationErr := normalizeRequired(*input.Title, "title", 255)
		if validationErr != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_title", validationErr.Error())
			return
		}
		updates["title"] = title
	}
	if input.Content != nil {
		if strings.TrimSpace(*input.Content) == "" {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_content", "content is required")
			return
		}
		if validationErr := validateOptionalLength(*input.Content, "content", 1_000_000); validationErr != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_content", validationErr.Error())
			return
		}
		updates["content"] = *input.Content
	}
	if input.Summary != nil {
		if validationErr := validateOptionalLength(*input.Summary, "summary", 10_000); validationErr != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_summary", validationErr.Error())
			return
		}
		updates["summary"] = *input.Summary
	}
	if input.Slug != nil {
		slug := slugify(*input.Slug)
		if slug == "" {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_slug", "slug must contain letters or numbers")
			return
		}
		updates["slug"] = slug
	}
	if input.CategoryID != nil {
		categoryID := normalizedCategoryID(input.CategoryID)
		if _, valid := validateCategory(c, config.DB, categoryID); !valid {
			return
		}
		updates["category_id"] = categoryID
	}

	status := post.Status
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
		if validationErr := validatePostStatus(status); validationErr != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_status", validationErr.Error())
			return
		}
		updates["status"] = status
	}
	if status == "published" {
		if post.PublishedAt == nil {
			now := time.Now()
			updates["published_at"] = &now
		}
	}
	if contentTouched && post.PublishedAt != nil {
		now := time.Now()
		updates["last_edited_at"] = &now
	}

	result := config.DB.Model(&models.Post{}).Where("id = ?", id).Updates(updates)
	if isUniqueViolation(result.Error) {
		apiresponse.Error(c, http.StatusConflict, "slug_conflict", "slug is already in use")
		return
	}
	if isConstraintViolation(result.Error) {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_post", "Post violates a data constraint")
		return
	}
	if result.Error != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not update post")
		return
	}
	if result.RowsAffected == 0 {
		apiresponse.Error(c, http.StatusNotFound, "post_not_found", "Post not found")
		return
	}
	post = models.Post{}
	if err := config.DB.Preload("Category").First(&post, id).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Post was updated but could not be reloaded")
		return
	}
	c.JSON(http.StatusOK, post)
}

func DeletePost(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	result := config.DB.Delete(&models.Post{}, id)
	if result.Error != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not delete post")
		return
	}
	if result.RowsAffected == 0 {
		apiresponse.Error(c, http.StatusNotFound, "post_not_found", "Post not found")
		return
	}
	apiresponse.Message(c, http.StatusOK, "Post deleted")
}

func normalizedCategoryID(categoryID *uint) *uint {
	if categoryID == nil || *categoryID == 0 {
		return nil
	}
	value := *categoryID
	return &value
}

func validateCategory(c *gin.Context, db *gorm.DB, categoryID *uint) (*models.Category, bool) {
	if categoryID == nil {
		return nil, true
	}
	var category models.Category
	err := db.First(&category, *categoryID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_category", "Selected category does not exist")
		return nil, false
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not validate category")
		return nil, false
	}
	return &category, true
}

func createPostWithAvailableSlug(post *models.Post, baseSlug string, explicit bool) error {
	maximumAttempts := 100
	if explicit {
		maximumAttempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= maximumAttempts; attempt++ {
		candidate := baseSlug
		if attempt > 1 {
			candidate = slugWithSuffix(baseSlug, fmt.Sprintf("-%d", attempt))
		}
		post.ID = 0
		post.Slug = candidate
		err := config.DB.Create(post).Error
		if err == nil {
			return nil
		}
		if !isUniqueViolation(err) {
			post.ID = 0
			return err
		}
		lastErr = err
	}
	post.ID = 0
	return lastErr
}

func slugify(value string) string {
	slug := strings.ToLower(strings.TrimSpace(value))
	slug = slugSeparatorRegex.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	return strings.Trim(truncateRunes(slug, maxSlugRunes), "-")
}

func slugWithSuffix(base, suffix string) string {
	return truncateRunes(base, maxSlugRunes-utf8.RuneCountInString(suffix)) + suffix
}

func truncateRunes(value string, maximum int) string {
	if utf8.RuneCountInString(value) <= maximum {
		return value
	}
	return string([]rune(value)[:maximum])
}
