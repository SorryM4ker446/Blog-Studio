package config

import (
	"log"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"blog-backend/internal/models"
)

var DB *gorm.DB

func InitDB() {
	// PostgreSQL DSN 格式: "host=localhost user=postgres password=您的密码 dbname=blog_db port=5432 sslmode=disable TimeZone=Asia/Shanghai"
	// 需在此前通过 psql 或 pgAdmin 执行建库: CREATE DATABASE blog_db;
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=101446 dbname=blog_db port=5432 sslmode=disable TimeZone=Asia/Shanghai"
	}

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
