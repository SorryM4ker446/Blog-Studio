package config

import (
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"blog-backend/internal/models"
)

var DB *gorm.DB

func InitDB() {
	dsn := Current().DatabaseDSN

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// 自动迁移
	err = db.AutoMigrate(&models.User{}, &models.Category{}, &models.Post{}, &models.File{}, &models.Setting{})
	if err != nil {
		log.Fatalf("Failed to auto migrate: %v", err)
	}

	// Drop existing foreign key constraint if it exists (allows category_id = 0 for "Uncategorized")
	db.Exec("ALTER TABLE posts DROP CONSTRAINT IF EXISTS fk_posts_category")

	DB = db
	log.Println("Database connection established and migration completed.")
}
