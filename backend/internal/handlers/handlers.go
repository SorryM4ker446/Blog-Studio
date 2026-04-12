package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"blog-backend/internal/config"
	"blog-backend/internal/models"

	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// ==================== Post 处理器 ====================

func GetPosts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if page < 1 { page = 1 }
	if limit < 1 || limit > 100 { limit = 10 }
	offset := (page - 1) * limit
	sort := c.Query("sort")
	categoryID := c.Query("category_id")

	var posts []models.Post
	var total int64
	
	db := config.DB.Model(&models.Post{})
	_, isAdmin := c.Get("username")
	if !isAdmin {
		db = db.Where("status = ?", "published")
	}

	if categoryID != "" {
		db = db.Where("category_id = ?", categoryID)
	}

	db.Count(&total)

	if sort == "admin" {
		// PostgreSQL CASE WHEN for placing drafts first
		db = db.Order("CASE WHEN status = 'draft' THEN 1 ELSE 2 END, updated_at desc")
	} else {
		db = db.Order("created_at desc")
	}

	result := db.Preload("Category").Limit(limit).Offset(offset).Find(&posts)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"data": posts,
		"total": total,
		"page": page,
		"limit": limit,
	})
}


func GetPost(c *gin.Context) {
	id := c.Param("id")
	var post models.Post
	
	db := config.DB.Preload("Category")
	_, isAdmin := c.Get("username")
	if !isAdmin {
		db = db.Where("status = ?", "published")
	}

	result := db.First(&post, id)
	if result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	c.JSON(http.StatusOK, post)
}

func CreatePost(c *gin.Context) {
	var post models.Post
	if err := c.ShouldBindJSON(&post); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	// 自动生成 Slug (如果缺失)
	if post.Slug == "" {
		slug := strings.ToLower(post.Title)
		reg := regexp.MustCompile(`[^a-z0-9\x{4e00}-\x{9fa5}]+`)
		slug = reg.ReplaceAllString(slug, "-")
		slug = strings.Trim(slug, "-")
		
		// 增加随机后缀防止标题重复导致的 unique constraint 错误
		post.Slug = fmt.Sprintf("%s-%d", slug, time.Now().Unix()%10000)
		if slug == "" {
			post.Slug = fmt.Sprintf("post-%d", time.Now().UnixNano())
		}
	}

	// Disable foreign key validation if CategoryID is 0 ("Uncategorized")
	if post.CategoryID != 0 {
		if err := config.DB.First(&models.Category{}, post.CategoryID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("业务错误：选择的分类 (ID: %d) 不存在，请重新选择或创建", post.CategoryID)})
			return
		}
	}

	result := config.DB.Create(&post)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error: " + result.Error.Error()})
		return
	}
	c.JSON(http.StatusCreated, post)
}

func UpdatePost(c *gin.Context) {
	id := c.Param("id")
	var post models.Post
	if err := config.DB.First(&post, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	var input struct {
		Title      string `json:"title"`
		Summary    string `json:"summary"`
		Content    string `json:"content"`
		CategoryID uint   `json:"category_id"`
		Status     string `json:"status"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Disable foreign key validation if CategoryID is 0 ("Uncategorized")
	if input.CategoryID != 0 {
		var cat models.Category
		if err := config.DB.First(&cat, input.CategoryID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "业务错误：选择的分类不存在，请重新选择"})
			return
		}
	}

	updates := map[string]interface{}{
		"title":       input.Title,
		"summary":     input.Summary,
		"content":     input.Content,
		"category_id": input.CategoryID,
		"status":      input.Status,
	}

	config.DB.Model(&post).Select("title", "summary", "content", "category_id", "status").Updates(updates)
	// We need to re-fetch the post to get the category (if any)
	config.DB.Preload("Category").First(&post, id)
	c.JSON(http.StatusOK, post)
}

func DeletePost(c *gin.Context) {
	id := c.Param("id")
	result := config.DB.Delete(&models.Post{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Post deleted"})
}

// ==================== Category 处理器 ====================

func GetCategories(c *gin.Context) {
	var categories []models.Category
	result := config.DB.Find(&categories)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	_, isAdmin := c.Get("username")

	for i := range categories {
		var count int64
		dbCount := config.DB.Model(&models.Post{}).Where("category_id = ?", categories[i].ID)
		if !isAdmin {
			dbCount = dbCount.Where("status = ?", "published")
		}
		dbCount.Count(&count)
		categories[i].PostCount = count
	}

	c.JSON(http.StatusOK, categories)
}

func CreateCategory(c *gin.Context) {
	var category models.Category
	if err := c.ShouldBindJSON(&category); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := config.DB.Create(&category)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	c.JSON(http.StatusCreated, category)
}

func UpdateCategory(c *gin.Context) {
	id := c.Param("id")
	var category models.Category
	if err := config.DB.First(&category, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	config.DB.Model(&category).Updates(models.Category{
		Name: input.Name,
	})
	c.JSON(http.StatusOK, category)
}

func DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	
	// Fallback logic: Set all related posts' CategoryID to 0
	config.DB.Model(&models.Post{}).Where("category_id = ?", id).Update("category_id", 0)

	result := config.DB.Delete(&models.Category{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Category deleted"})
}

// ==================== File 处理器（云盘） ====================

const uploadDir = "./uploads"

func init() {
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		panic("Failed to create uploads directory: " + err.Error())
	}
}

func GetFiles(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if page < 1 { page = 1 }
	if limit < 1 || limit > 100 { limit = 10 }
	offset := (page - 1) * limit

	var files []models.File
	var total int64

	db := config.DB.Model(&models.File{}).Where("is_system IS NOT TRUE")
	db.Count(&total)

	result := db.Order("created_at desc").Limit(limit).Offset(offset).Find(&files)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"data": files,
		"total": total,
		"page": page,
		"limit": limit,
	})
}

func UploadFile(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
		return
	}
	defer file.Close()

	// 生成唯一文件名防止冲突
	ext := filepath.Ext(header.Filename)
	storedName := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	savePath := filepath.Join(uploadDir, storedName)

	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write file"})
		return
	}

	record := models.File{
		Name:     storedName,
		OrigName: header.Filename,
		Path:     savePath,
		Size:     header.Size,
		MimeType: header.Header.Get("Content-Type"),
		IsSystem: c.Query("system") == "true",
	}
	
	if record.IsSystem {
		fmt.Printf("[DEBUG] Uploading system file: %s\n", header.Filename)
	}

	config.DB.Create(&record)
	c.JSON(http.StatusCreated, record)
}

func DownloadFile(c *gin.Context) {
	id := c.Param("id")
	var file models.File
	if err := config.DB.First(&file, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	c.FileAttachment(file.Path, file.OrigName)
}

func DeleteFile(c *gin.Context) {
	id := c.Param("id")
	var file models.File
	if err := config.DB.First(&file, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	// 删除磁盘文件
	os.Remove(file.Path)
	config.DB.Delete(&file)
	c.JSON(http.StatusOK, gin.H{"message": "File deleted"})
}

// ==================== 搜索处理器 ====================

func SearchResources(c *gin.Context) {
	q := c.Query("q")
	scope := c.Query("scope") // optional: "posts", "files", "all"
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'q' is required"})
		return
	}

	likeQ := "%" + q + "%"

	var posts []models.Post
	var files []models.File

	_, isAdmin := c.Get("username")

	if scope == "" || scope == "all" || scope == "posts" {
		db := config.DB.Joins("LEFT JOIN categories ON categories.id = posts.category_id").Preload("Category")
		if !isAdmin {
			db = db.Where("posts.status = ?", "published")
		}
		db.Where("(posts.title ILIKE ? OR posts.content ILIKE ? OR categories.name ILIKE ?)", likeQ, likeQ, likeQ).
			Find(&posts)
	}

	if scope == "" || scope == "all" || scope == "files" {
		config.DB.Where("orig_name ILIKE ? AND is_system IS NOT TRUE", likeQ).Find(&files)
	}

	c.JSON(http.StatusOK, gin.H{
		"posts": posts,
		"files": files,
	})
}
