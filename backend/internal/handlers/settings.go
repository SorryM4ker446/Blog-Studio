package handlers

import (
	"net/http"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
)

// GetSettings retrieves all settings
func GetSettings(c *gin.Context) {
	var settings []models.Setting
	config.DB.Find(&settings)

	// Convert to a neat key-value map
	settingsMap := make(map[string]string)
	for _, s := range settings {
		settingsMap[s.Key] = s.Value
	}

	c.JSON(http.StatusOK, settingsMap)
}

// UpdateSettings updates multiple settings
func UpdateSettings(c *gin.Context) {
	var input map[string]string
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	for k, v := range input {
		// Use Upsert logic
		var setting models.Setting
		result := config.DB.Where("key = ?", k).First(&setting)
		if result.Error == nil {
			config.DB.Model(&setting).Update("value", v)
		} else {
			setting = models.Setting{Key: k, Value: v}
			config.DB.Create(&setting)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Settings updated successfully"})
}
