package main

import (
	"log"
	"os"

	"blog-backend/internal/config"
	"blog-backend/internal/models"
	
	"golang.org/x/crypto/bcrypt"
)

func main() {
	// Initialize database
	config.InitDB()

	// Default admin info
	username := "admin"
	password := "123456"

	// Allow overrides via env
	if u := os.Getenv("ADMIN_USER"); u != "" {
		username = u
	}
	if p := os.Getenv("ADMIN_PASS"); p != "" {
		password = p
	}

	// Check if admin exists
	var existing models.User
	result := config.DB.Where("username = ?", username).First(&existing)
	
	if result.Error == nil {
		log.Printf("User '%s' already exists. Updating password...\n", username)
		hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		config.DB.Model(&existing).Update("PasswordHash", string(hash))
		log.Println("Password updated successfully.")
	} else {
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
