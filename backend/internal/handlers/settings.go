package handlers

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var avatarFileRegex = regexp.MustCompile(`/api/files/(\d+)/(?:download|view)\b`)

func GetSettings(c *gin.Context) {
	var settings []models.Setting
	if err := config.DB.Order("key ASC").Find(&settings).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load settings")
		return
	}
	settingsMap := make(map[string]string, len(settings))
	for _, setting := range settings {
		settingsMap[setting.Key] = setting.Value
	}

	if avatar := settingsMap["profile_avatar"]; avatar != "" {
		matches := avatarFileRegex.FindStringSubmatch(avatar)
		if len(matches) == 2 {
			if fileID, err := strconv.ParseUint(matches[1], 10, 64); err == nil {
				var file models.File
				dbErr := config.DB.First(&file, uint(fileID)).Error
				if errors.Is(dbErr, gorm.ErrRecordNotFound) {
					settingsMap["profile_avatar"] = ""
				} else if dbErr != nil {
					apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not validate avatar setting")
					return
				} else if resolvedPath, resolveErr := resolveStoredFilePath(file.Path, file.Name); resolveErr != nil {
					settingsMap["profile_avatar"] = ""
				} else if resolvedPath != file.Path {
					if updateErr := config.DB.Model(&file).Update("path", resolvedPath).Error; updateErr != nil {
						log.Printf("update avatar file path for file %d: %v", file.ID, updateErr)
					}
				}
			}
		}
	}
	c.JSON(http.StatusOK, settingsMap)
}

func UpdateSettings(c *gin.Context) {
	var input map[string]string
	if !bindJSON(c, &input) {
		return
	}
	if len(input) == 0 {
		apiresponse.Error(c, http.StatusBadRequest, "empty_settings", "At least one setting is required")
		return
	}
	if len(input) > 100 {
		apiresponse.Error(c, http.StatusBadRequest, "too_many_settings", "No more than 100 settings may be updated at once")
		return
	}

	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	settings := make([]models.Setting, 0, len(keys))
	for _, rawKey := range keys {
		key := strings.TrimSpace(rawKey)
		if key == "" || key != rawKey {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_setting_key", "Setting keys must not be blank or contain surrounding whitespace")
			return
		}
		if err := validateOptionalLength(key, "setting key", 100); err != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_setting_key", err.Error())
			return
		}
		value := input[rawKey]
		if err := validateOptionalLength(value, "setting value", 100_000); err != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_setting_value", err.Error())
			return
		}
		settings = append(settings, models.Setting{Key: key, Value: value})
	}

	err := config.DB.Transaction(func(tx *gorm.DB) error {
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
		}).Create(&settings).Error
	})
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not update settings")
		return
	}
	apiresponse.Message(c, http.StatusOK, "Settings updated successfully")
}
