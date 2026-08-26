package handlers

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/filestore"
	"blog-backend/internal/httpcache"
	"blog-backend/internal/models"
	"blog-backend/internal/observability"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	multipartOverheadAllowance = int64(1024 * 1024)
	maxFileDisplayNameRunes    = 255
	maxFileDescriptionRunes    = 500
)

type updateFileRequest struct {
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
}

type missingFileContent struct {
	ID       uint   `json:"id"`
	OrigName string `json:"orig_name"`
}

func respondWithFiles(c *gin.Context, includeSystem, publicRead bool) {
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
	if publicRead {
		httpcache.PublicRead(c)
	}
	c.JSON(http.StatusOK, gin.H{"data": files, "total": total, "page": page, "limit": limit})
}

func GetFiles(c *gin.Context) {
	respondWithFiles(c, false, true)
}

func AdminGetFiles(c *gin.Context) {
	includeSystem, err := strconv.ParseBool(c.DefaultQuery("include_system", "true"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_include_system", "include_system must be true or false")
		return
	}
	respondWithFiles(c, includeSystem, false)
}

func UploadFile(c *gin.Context) {
	isSystem, err := strconv.ParseBool(c.DefaultQuery("system", "false"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_system", "system must be true or false")
		return
	}

	maxUploadBytes := config.Current().MaxUploadBytes
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadBytes+multipartOverheadAllowance)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		if isRequestTooLarge(err) {
			apiresponse.Error(c, http.StatusRequestEntityTooLarge, "file_too_large", "File exceeds the configured upload limit")
			return
		}
		apiresponse.Error(c, http.StatusBadRequest, "missing_file", "No valid file was provided")
		return
	}
	defer file.Close()
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}

	if header.Size == 0 {
		apiresponse.Error(c, http.StatusBadRequest, "empty_file", "Empty files are not allowed")
		return
	}
	if header.Size > maxUploadBytes {
		apiresponse.Error(c, http.StatusRequestEntityTooLarge, "file_too_large", "File exceeds the configured upload limit")
		return
	}
	originalName, err := filestore.SanitizeOriginalName(header.Filename)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_file_name", "File name is invalid")
		return
	}
	displayName := strings.TrimSpace(c.PostForm("display_name"))
	if displayName == "" {
		displayName = originalName
	}
	displayName, err = normalizeRequired(displayName, "display_name", maxFileDisplayNameRunes)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_display_name", err.Error())
		return
	}
	description := strings.TrimSpace(c.PostForm("description"))
	if err := validateOptionalLength(description, "description", maxFileDescriptionRunes); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_description", err.Error())
		return
	}
	fileType, err := filestore.DetectAllowedType(file, originalName)
	if err != nil {
		if errors.Is(err, filestore.ErrUnsupportedType) || errors.Is(err, filestore.ErrContentTypeMismatch) {
			apiresponse.Error(c, http.StatusUnsupportedMediaType, "unsupported_file_type", "File extension and content type must match an allowed format")
			return
		}
		apiresponse.Error(c, http.StatusBadRequest, "file_read_error", "Could not inspect uploaded file")
		return
	}

	store, err := currentFileStore()
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "File storage is unavailable")
		return
	}
	storedName, err := filestore.RandomStorageKey(fileType.Extension)
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not allocate storage for file")
		return
	}
	written, err := store.Save(storedName, file, maxUploadBytes)
	if errors.Is(err, filestore.ErrFileTooLarge) {
		apiresponse.Error(c, http.StatusRequestEntityTooLarge, "file_too_large", "File exceeds the configured upload limit")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Failed to save file")
		return
	}
	if written == 0 {
		_ = store.Remove(storedName)
		apiresponse.Error(c, http.StatusBadRequest, "empty_file", "Empty files are not allowed")
		return
	}

	record := models.File{
		Name: storedName, OrigName: originalName, DisplayName: displayName, Description: description,
		Path: storedName, Size: written, MimeType: fileType.MIME, IsSystem: isSystem,
	}
	if err := config.DB.Create(&record).Error; err != nil {
		if removeErr := store.Remove(storedName); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			observability.FromGin(c).ErrorContext(c.Request.Context(), "uploaded content rollback failed", "error", removeErr)
		}
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not record uploaded file")
		return
	}
	c.JSON(http.StatusCreated, record)
}

func UpdateFile(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input updateFileRequest
	if !bindJSON(c, &input) {
		return
	}
	displayName, err := normalizeRequired(input.DisplayName, "display_name", maxFileDisplayNameRunes)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_display_name", err.Error())
		return
	}
	description := strings.TrimSpace(input.Description)
	if err := validateOptionalLength(description, "description", maxFileDescriptionRunes); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_description", err.Error())
		return
	}

	var record models.File
	if err := config.DB.First(&record, id).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		return
	} else if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load file")
		return
	}
	if err := config.DB.Model(&record).Updates(map[string]any{
		"display_name": displayName,
		"description":  description,
	}).Error; err != nil {
		if isConstraintViolation(err) {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_file_metadata", "File metadata violates database constraints")
			return
		}
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not update file")
		return
	}
	record.DisplayName = displayName
	record.Description = description
	c.JSON(http.StatusOK, record)
}

func DownloadFile(c *gin.Context) {
	serveStoredFile(c, true)
}

func ViewFile(c *gin.Context) {
	serveStoredFile(c, false)
}

func serveStoredFile(c *gin.Context, forceAttachment bool) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var record models.File
	err := config.DB.First(&record, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load file")
		return
	}
	store, err := currentFileStore()
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "File storage is unavailable")
		return
	}
	storageKey, content, info, err := openStoredFile(store, record)
	if err != nil {
		apiresponse.Error(c, http.StatusNotFound, "file_content_not_found", "File content not found")
		return
	}
	defer content.Close()
	if storageKey != record.Path {
		if err := config.DB.Model(&record).Update("path", storageKey).Error; err != nil {
			observability.FromGin(c).WarnContext(c.Request.Context(), "file storage key normalization failed", "file_id", record.ID, "error", err)
		}
	}

	fileType, typeErr := filestore.DetectAllowedType(content, record.OrigName)
	contentType := "application/octet-stream"
	inline := false
	if typeErr == nil {
		contentType = fileType.MIME
		inline = fileType.Inline
		if record.MimeType != contentType {
			if err := config.DB.Model(&record).Update("mime_type", contentType).Error; err != nil {
				observability.FromGin(c).WarnContext(c.Request.Context(), "file MIME type normalization failed", "file_id", record.ID, "error", err)
			}
		}
	}
	if _, err := content.Seek(0, io.SeekStart); err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not read file content")
		return
	}

	disposition := "inline"
	if forceAttachment || !inline {
		disposition = "attachment"
	}
	downloadName, err := filestore.SanitizeOriginalName(record.OrigName)
	if err != nil {
		downloadName = "download"
	}
	contentDisposition := mime.FormatMediaType(disposition, map[string]string{"filename": downloadName})
	if contentDisposition == "" {
		contentDisposition = disposition
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", contentDisposition)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	c.Header("Referrer-Policy", "no-referrer")
	httpcache.PublicFile(c)
	c.Header("ETag", httpcache.WeakFileETag(storageKey, info.Size(), info.ModTime()))
	http.ServeContent(c.Writer, c.Request, downloadName, info.ModTime(), content)
}

func DeleteFile(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var record models.File
	err := config.DB.First(&record, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		return
	}
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load file")
		return
	}
	inUse, err := fileIsReferenced(record.ID)
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not validate file references")
		return
	}
	if inUse {
		apiresponse.Error(c, http.StatusConflict, "file_in_use", "File is referenced by article content or settings")
		return
	}

	store, err := currentFileStore()
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "File storage is unavailable")
		return
	}
	storageKey := ""
	quarantineKey := ""
	if key, content, _, openErr := openStoredFile(store, record); openErr == nil {
		storageKey = key
		if closeErr := content.Close(); closeErr != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not prepare file for deletion")
			return
		}
		quarantineKey, err = store.Quarantine(storageKey)
		if err != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not prepare file for deletion")
			return
		}
	}

	result := config.DB.Delete(&models.File{}, id)
	if result.Error != nil || result.RowsAffected == 0 {
		if quarantineKey != "" {
			if restoreErr := store.Restore(quarantineKey, storageKey); restoreErr != nil {
				observability.FromGin(c).ErrorContext(c.Request.Context(), "file restore compensation failed", "file_id", id, "error", restoreErr)
			}
		}
		if result.Error != nil {
			apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not delete file")
		} else {
			apiresponse.Error(c, http.StatusNotFound, "file_not_found", "File not found")
		}
		return
	}
	if quarantineKey != "" {
		if err := store.Remove(quarantineKey); err != nil && !errors.Is(err, os.ErrNotExist) {
			observability.FromGin(c).WarnContext(c.Request.Context(), "quarantined file cleanup failed", "file_id", id, "error", err)
		}
	}
	apiresponse.Message(c, http.StatusOK, "File deleted")
}

func GetFileStorageHealth(c *gin.Context) {
	store, err := currentFileStore()
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "File storage is unavailable")
		return
	}
	var records []models.File
	if err := config.DB.Order("id ASC").Find(&records).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not inspect file records")
		return
	}
	knownKeys := make(map[string]struct{}, len(records))
	missing := make([]missingFileContent, 0)
	for _, record := range records {
		key, content, _, openErr := openStoredFile(store, record)
		if openErr != nil {
			missing = append(missing, missingFileContent{ID: record.ID, OrigName: record.OrigName})
			continue
		}
		knownKeys[key] = struct{}{}
		_ = content.Close()
	}
	keys, err := store.ListKeys()
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "storage_error", "Could not inspect stored content")
		return
	}
	orphaned := make([]string, 0)
	for _, key := range keys {
		if _, exists := knownKeys[key]; !exists {
			orphaned = append(orphaned, key)
		}
	}
	sort.Strings(orphaned)
	c.JSON(http.StatusOK, gin.H{"missing_content": missing, "orphaned_content": orphaned})
}

func fileIsReferenced(fileID uint) (bool, error) {
	fragment := fmt.Sprintf("%%/api/files/%d/%%", fileID)
	var postCount int64
	if err := config.DB.Model(&models.Post{}).
		Where("content LIKE ? OR summary LIKE ?", fragment, fragment).
		Count(&postCount).Error; err != nil {
		return false, err
	}
	if postCount > 0 {
		return true, nil
	}
	var settingCount int64
	if err := config.DB.Model(&models.Setting{}).Where("value LIKE ?", fragment).Count(&settingCount).Error; err != nil {
		return false, err
	}
	return settingCount > 0, nil
}

func isRequestTooLarge(err error) bool {
	var maxBytesError *http.MaxBytesError
	return errors.As(err, &maxBytesError) || strings.Contains(strings.ToLower(err.Error()), "request body too large")
}
