package main

import (
	"log"

	"blog-backend/internal/config"
	"blog-backend/internal/routes"
)

func main() {
	log.Println("Starting Blog Backend System...")
	
	// 初始化数据库
	config.InitDB()

	// 配置路由
	r := routes.SetupRouter()

	// 启动 HTTP 服务，侦听 8080 端口
	log.Println("Server is running at http://localhost:8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
}
