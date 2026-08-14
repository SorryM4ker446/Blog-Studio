package main

import (
	"log"

	"blog-backend/internal/config"
	"blog-backend/internal/routes"
)

func main() {
	log.Println("Starting Blog Backend System...")

	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("Invalid application configuration: %v", err)
	}

	// 初始化数据库
	config.InitDB()

	// 配置路由
	r := routes.SetupRouter()

	// 启动 HTTP 服务
	log.Printf("Server is listening on %s", cfg.ServerAddress)
	if err := r.Run(cfg.ServerAddress); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
}
