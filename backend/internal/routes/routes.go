package routes

import (
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/handlers"
	"blog-backend/internal/health"
	"blog-backend/internal/httpcache"
	"blog-backend/internal/middleware"
	"blog-backend/internal/observability"
	"blog-backend/internal/security"
	"github.com/gin-gonic/gin"
)

func SetupRouter() *gin.Engine {
	cfg := config.Current()
	return SetupRouterWithHealth(health.NewChecker(config.DB, cfg.UploadDir, cfg.HealthCheckTimeout))
}

func SetupRouterWithHealth(healthChecker *health.Checker) *gin.Engine {
	cfg := config.Current()
	return setupRouter(
		healthChecker,
		observability.NewMetrics(),
		security.NewPublicSearchLimiter(cfg.PublicSearchRatePerMinute, cfg.PublicSearchBurst),
	)
}

func setupRouter(
	healthChecker *health.Checker,
	metrics *observability.Metrics,
	searchLimiter *security.PublicSearchLimiter,
) *gin.Engine {
	cfg := config.Current()
	r := gin.New()
	if err := r.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		panic(fmt.Sprintf("validated trusted proxy configuration was rejected: %v", err))
	}
	r.Use(observability.RequestMiddleware(slog.Default()))
	r.Use(metrics.Middleware())
	r.Use(observability.RecoveryMiddleware())
	r.Use(httpcache.DefaultNoStore())

	r.GET("/health/live", health.Liveness)
	r.GET("/health/ready", healthChecker.Readiness)
	r.GET("/internal/metrics", metrics.Handler)

	r.Use(corsMiddleware(cfg.AllowedOrigins))

	api := r.Group("/api")
	{
		// 公开接口
		public := api.Group("/")
		{
			public.GET("/posts", handlers.GetPosts)
			public.GET("/posts/:id", handlers.GetPost)
			public.GET("/categories", handlers.GetCategories)
			public.GET("/search", publicSearchRateLimitMiddleware(searchLimiter, metrics), handlers.SearchResources)
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

func publicSearchRateLimitMiddleware(
	limiter *security.PublicSearchLimiter,
	metrics *observability.Metrics,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		if allowed, retryAfter := limiter.Allow(c.ClientIP()); !allowed {
			seconds := max(1, int(math.Ceil(retryAfter.Seconds())))
			c.Header("Retry-After", strconv.Itoa(seconds))
			metrics.ObservePublicSearchRateLimitRejection()
			apiresponse.AbortError(
				c,
				http.StatusTooManyRequests,
				"search_rate_limited",
				"Too many search requests; try again shortly",
			)
			return
		}
		c.Next()
	}
}

func corsMiddleware(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}

	return func(c *gin.Context) {
		c.Writer.Header().Add("Vary", "Origin")
		origin := c.GetHeader("Origin")
		if origin != "" {
			if _, ok := allowed[origin]; !ok {
				apiresponse.AbortError(c, http.StatusForbidden, "origin_not_allowed", "Origin not allowed")
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
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
