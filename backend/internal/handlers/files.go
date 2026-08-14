package handlers

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var uploadDir = resolveUploadDir()

func init() {
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		panic("Failed to create uploads directory: " + err.Error())
	}
}

func respondWithFiles(c *gin.Context, includeSystem bool) {
	page, limit, ok := parsePagination(c)
	if !ok {
		return
	}
	var files []models.File
	var total int64
	db := config.DB.Model(&models.File{})
	if !includeSystem {
		db = db.Where("is_system IS NOT TRUE")
	}
	if err := db.Count(&total).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load files")
		return
	}
	if err := db.Order("created_at DESC, id DESC").Limit(limit).Offset(safeOffset(page, limit)).Find(&files).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load files")
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": files, "total": total, "page": page, "limit": limit})
}

func GetFiles(c *gin.Context) {
	respondWithFiles(c, false)
}

func AdminGetFiles(c *gin.Context) {
	includeSystem, err := strconv.ParseBool(c.DefaultQuery("include_system", "true"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_include_system", "include_system must be true or false")
		return
	}
	respondWithFiles(c, includeSystem)
}

func UploadFile(c *gin.Context) {
	isSystem, err := strconv.ParseBool(c.DefaultQuery("system", "false"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_system", "system must be true or false")
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "missing_file", "No file provided")
		return
	}
	defer file.Close()

	ext := filepath.Ext(header.Filename)
	storedName := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext)
	savePath, err := filepath.Abs(filepath.Join(uploadDir, storedName))
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not resolve upload path")
		return
	}
	destination, err := os.OpenFile(savePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Failed to save file")
		return
	}
	written, copyErr := io.Copy(destination, file)
	closeErr := destination.Close()
	if copyErr != nil || closeErr != nil {
		if removeErr := os.Remove(savePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			log.Printf("remove partial upload %q: %v", savePath, removeErr)
		}
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Failed to write file")
		return
	}

	record := models.File{
		Name: storedName, OrigName: header.Filename, Path: savePath, Size: written,
		MimeType: header.Header.Get("Content-Type"), IsSystem: isSystem,
	}
	if err := config.DB.Create(&record).Error; err != nil {
		if removeErr := os.Remove(savePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			log.Printf("rollback uploaded file %q: %v", savePath, removeErr)
		}
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not record uploaded file")
		return
	}
	c.JSON(http.StatusCreated, record)
}

func DownloadFile(c *gin.Context) {
	serveStoredFile(c, true)
}

func ViewFile(c *gin.Context) {
	serveStoredFile(c, false)
}

func serveStoredFile(c *gin.Context, attachment bool) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var file models.File
	err := config.DB.First(&file, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load file")
		return
	}
	resolvedPath, resolveErr := resolveStoredFilePath(file.Path, file.Name)
	if resolveErr != nil {
		apiresponse.Error(c, http.StatusNotFound, "file_content_not_found", "File content not found")
		return
	}
	if resolvedPath != file.Path {
		if err := config.DB.Model(&file).Update("path", resolvedPath).Error; err != nil {
			log.Printf("update resolved path for file %d: %v", file.ID, err)
		}
	}
	if attachment {
		c.FileAttachment(resolvedPath, file.OrigName)
		return
	}
	if file.MimeType != "" {
		c.Header("Content-Type", file.MimeType)
	}
	safeName := strings.ReplaceAll(file.OrigName, `"`, "")
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", safeName))
	c.File(resolvedPath)
}

func DeleteFile(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var file models.File
	err := config.DB.First(&file, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load file")
		return
	}

	resolvedPath, resolveErr := resolveStoredFilePath(file.Path, file.Name)
	quarantinePath := ""
	if resolveErr == nil {
		quarantinePath = resolvedPath + fmt.Sprintf(".deleting-%d", time.Now().UnixNano())
		if err := os.Rename(resolvedPath, quarantinePath); err != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not prepare file for deletion")
			return
		}
	}

	result := config.DB.Delete(&models.File{}, id)
	if result.Error != nil || result.RowsAffected == 0 {
		if quarantinePath != "" {
			if restoreErr := os.Rename(quarantinePath, resolvedPath); restoreErr != nil {
				log.Printf("restore file %d after database delete failure: %v", id, restoreErr)
			}
		}
		if result.Error != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not delete file")
		} else {
			apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		}
		return
	}
	if quarantinePath != "" {
		if err := os.Remove(quarantinePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("remove quarantined file %d at %q: %v", id, quarantinePath, err)
		}
	}
	apiresponse.Message(c, http.StatusOK, "File deleted")
}
