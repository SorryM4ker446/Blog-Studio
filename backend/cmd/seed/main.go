package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"blog-backend/internal/security"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	if err := security.ValidatePassword(password, username); err != nil {
		log.Fatalf("ADMIN_PASS is invalid: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("Error hashing password: %v", err)
	}
	createdDefaultCategory := false
	err = config.DB.Transaction(func(tx *gorm.DB) error {
		var existing models.User
		result := tx.Where("username = ?", username).First(&existing)
		if result.Error == nil {
			return fmt.Errorf("user %q already exists; refusing to overwrite its password", username)
		}
		if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return fmt.Errorf("check whether user exists: %w", result.Error)
		}
		admin := models.User{Username: username, PasswordHash: string(hash), Role: "admin"}
		if err := tx.Create(&admin).Error; err != nil {
			return fmt.Errorf("create user: %w", err)
		}

		settings := []models.Setting{
			{Key: "site_title", Value: "Blog Studio"},
			{Key: "site_description", Value: "Welcome to my personal studio!"},
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&settings).Error; err != nil {
			return fmt.Errorf("create default settings: %w", err)
		}
		var categoryCount int64
		if err := tx.Model(&models.Category{}).Count(&categoryCount).Error; err != nil {
			return fmt.Errorf("count categories: %w", err)
		}
		if categoryCount == 0 {
			category := models.Category{Name: "General", Description: "Default category for all posts."}
			if err := tx.Create(&category).Error; err != nil {
				return fmt.Errorf("create default category: %w", err)
			}
			createdDefaultCategory = true
		}
		return nil
	})
	if err != nil {
		log.Fatalf("Seed transaction failed: %v", err)
	}
	if createdDefaultCategory {
		log.Println("Created default category 'General'.")
	}

	log.Printf("Successfully created admin '%s' with default settings.\n", username)
}
