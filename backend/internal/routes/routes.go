package routes

import (
	"blog-backend/internal/handlers"
	"blog-backend/internal/middleware"
	"github.com/gin-gonic/gin"
)

func SetupRouter() *gin.Engine {
	r := gin.Default()

	// 跨域简易处理 (本地开发)
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		// 公开接口
		public := api.Group("/")
		{
			public.GET("/posts", handlers.GetPosts)
			public.GET("/posts/:id", handlers.GetPost)
			public.GET("/categories", handlers.GetCategories)
			public.GET("/search", handlers.SearchResources)
			public.GET("/files", handlers.GetFiles)
			public.GET("/files/:id/view", handlers.ViewFile)
			public.HEAD("/files/:id/view", handlers.ViewFile)
			public.GET("/files/:id/download", handlers.DownloadFile)
			public.HEAD("/files/:id/download", handlers.DownloadFile)
		}

		// Auth & Settings (Public reading)
		api.POST("/login", handlers.Login)
		api.GET("/settings", handlers.GetSettings)

		// 受保护接口
		auth := api.Group("/admin")
		auth.Use(middleware.AuthMiddleware(), middleware.RequireAdminMiddleware())
		{
			auth.GET("/me", handlers.Me)
			auth.GET("/posts", handlers.AdminGetPosts)
			auth.GET("/categories", handlers.AdminGetCategories)
			auth.GET("/files", handlers.AdminGetFiles)
			auth.GET("/search", handlers.AdminSearchResources)
			auth.PUT("/password", handlers.UpdatePassword)
			auth.PUT("/settings", handlers.UpdateSettings)

			auth.POST("/posts", handlers.CreatePost)
			auth.PUT("/posts/:id", handlers.UpdatePost)
			auth.DELETE("/posts/:id", handlers.DeletePost)

			auth.POST("/categories", handlers.CreateCategory)
			auth.PUT("/categories/:id", handlers.UpdateCategory)
			auth.DELETE("/categories/:id", handlers.DeleteCategory)

			auth.POST("/files", handlers.UploadFile)
			auth.DELETE("/files/:id", handlers.DeleteFile)
		}
	}

	return r
}
