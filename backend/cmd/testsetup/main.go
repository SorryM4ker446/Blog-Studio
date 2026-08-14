package main

import (
	"log"
	"os"
	"strings"

	"blog-backend/internal/models"
	"blog-backend/internal/testutil"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	db, err := testutil.OpenDatabase()
	if err != nil {
		log.Fatalf("Open test database: %v", err)
	}
	if err := testutil.ResetDatabase(db); err != nil {
		log.Fatalf("Reset test database: %v", err)
	}

	username := strings.TrimSpace(os.Getenv("E2E_ADMIN_USER"))
	password := os.Getenv("E2E_ADMIN_PASS")
	if username == "" || len(password) < 12 {
		log.Fatal("E2E_ADMIN_USER and an E2E_ADMIN_PASS of at least 12 characters are required")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		log.Fatalf("Hash E2E password: %v", err)
	}
	admin := models.User{Username: username, PasswordHash: string(hash), Role: "admin"}
	if err := db.Create(&admin).Error; err != nil {
		log.Fatalf("Create E2E administrator: %v", err)
	}
	if err := db.Create(&models.Category{Name: "General", Description: "E2E default category"}).Error; err != nil {
		log.Fatalf("Create E2E category: %v", err)
	}

	log.Println("E2E test database is ready.")
}
