package main

import (
	"errors"
	"log"
	"os"
	"strings"
	"unicode/utf8"

	"blog-backend/internal/config"
	"blog-backend/internal/models"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func main() {
	if _, err := config.LoadFromEnv(); err != nil {
		log.Fatalf("Invalid application configuration: %v", err)
	}

	// Initialize database
	config.InitDB()

	username := strings.TrimSpace(os.Getenv("ADMIN_USER"))
	if username == "" {
		log.Fatal("ADMIN_USER is required")
	}
	password := os.Getenv("ADMIN_PASS")
	if password == "" {
		log.Fatal("ADMIN_PASS is required")
	}
	if utf8.RuneCountInString(password) < 12 {
		log.Fatal("ADMIN_PASS must be at least 12 characters")
	}

	// Check if admin exists
	var existing models.User
	result := config.DB.Where("username = ?", username).First(&existing)

	if result.Error == nil {
		log.Fatalf("User '%s' already exists; refusing to overwrite its password", username)
	} else if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		// Create new admin
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("Error hashing password: %v", err)
		}

		admin := models.User{
			Username:     username,
			PasswordHash: string(hash),
			Role:         "admin",
		}

		if err := config.DB.Create(&admin).Error; err != nil {
			log.Fatalf("Error creating user: %v", err)
		}
	} else {
		log.Fatalf("Error checking whether user exists: %v", result.Error)
	}

	// Create default configurations
	settings := []models.Setting{
		{Key: "site_title", Value: "Blog Studio"},
		{Key: "site_description", Value: "Welcome to my personal studio!"},
	}
	for _, s := range settings {
		var check models.Setting
		if config.DB.Where("key = ?", s.Key).First(&check).Error != nil {
			config.DB.Create(&s)
		}
	}

	// Create default category (ID: 1)
	var catCount int64
	config.DB.Model(&models.Category{}).Count(&catCount)
	if catCount == 0 {
		config.DB.Create(&models.Category{
			Name:        "General",
			Description: "Default category for all posts.",
		})
		log.Println("Created default category 'General'.")
	}

	log.Printf("Successfully created admin '%s' with default settings.\n", username)
}
