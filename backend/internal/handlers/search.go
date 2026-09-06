package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/httpcache"
	"blog-backend/internal/search"
	"github.com/gin-gonic/gin"
)

func respondWithSearchResults(c *gin.Context, adminAccess bool, includeSystem bool) {
	query, ok := validateSearchQuery(c)
	if !ok {
		return
	}
	scope := strings.TrimSpace(c.Query("scope"))
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "posts" && scope != "files" {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_scope", "scope must be posts, files, or all")
		return
	}
	categoryID, ok := parseCategoryFilter(c)
	if !ok {
		return
	}

	page, limit, ok := parsePagination(c)
	if !ok {
		return
	}
	result, err := search.Read(config.DB.WithContext(c.Request.Context()), search.Options{
		Query: query, Scope: scope, CategoryID: categoryID, Admin: adminAccess, IncludeSystem: includeSystem, Page: page, Limit: limit,
	})
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not search resources")
		return
	}
	if !adminAccess {
		httpcache.PublicRead(c)
	}
	c.JSON(http.StatusOK, result)
}

func SearchResources(c *gin.Context) {
	respondWithSearchResults(c, false, false)
}

func AdminSearchResources(c *gin.Context) {
	includeSystem, err := strconv.ParseBool(c.DefaultQuery("include_system", "true"))
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_include_system", "include_system must be true or false")
		return
	}
	respondWithSearchResults(c, true, includeSystem)
}
