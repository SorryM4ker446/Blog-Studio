package routes

import (
	"net/http"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/handlers"
	"blog-backend/internal/middleware"
	"github.com/gin-gonic/gin"
)

func SetupRouter() *gin.Engine {
	r := gin.Default()

	r.Use(corsMiddleware(config.Current().AllowedOrigins))

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
		api.GET("/csrf", handlers.CSRFToken)
		api.POST("/login", middleware.CSRFMiddleware(), handlers.Login)
		api.GET("/settings", handlers.GetSettings)

		// Session endpoints are available to every authenticated account so that
		// non-admin users can restore their identity and end their own session.
		sessionAuth := api.Group("/admin")
		sessionAuth.Use(middleware.AuthMiddleware(), middleware.CSRFMiddleware())
		{
			sessionAuth.GET("/me", handlers.Me)
			sessionAuth.POST("/logout", handlers.Logout)
		}

		// All content-management endpoints still require the administrator role.
		auth := api.Group("/admin")
		auth.Use(middleware.AuthMiddleware(), middleware.RequireAdminMiddleware(), middleware.CSRFMiddleware())
		{
			auth.GET("/posts", handlers.AdminGetPosts)
			auth.GET("/categories", handlers.AdminGetCategories)
			auth.GET("/files", handlers.AdminGetFiles)
			auth.GET("/files/storage-health", handlers.GetFileStorageHealth)
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
			auth.PUT("/files/:id", handlers.UpdateFile)
			auth.DELETE("/files/:id", handlers.DeleteFile)
		}
	}

	return r
}

func corsMiddleware(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if _, ok := allowed[origin]; !ok {
				apiresponse.AbortError(c, http.StatusForbidden, "origin_not_allowed", "Origin not allowed")
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
