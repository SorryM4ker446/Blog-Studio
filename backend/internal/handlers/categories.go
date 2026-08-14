package handlers

import (
	"net/http"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
)

type createCategoryInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type updateCategoryInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func respondWithCategories(c *gin.Context, includeDrafts bool) {
	var categories []models.Category
	join := "LEFT JOIN posts ON posts.category_id = categories.id"
	arguments := []any{}
	if !includeDrafts {
		join += " AND posts.status = ?"
		arguments = append(arguments, "published")
	}
	err := config.DB.Model(&models.Category{}).
		Select("categories.*, COUNT(posts.id) AS post_count").
		Joins(join, arguments...).
		Group("categories.id").
		Order("categories.name ASC, categories.id ASC").
		Scan(&categories).Error
	if err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not load categories")
		return
	}
	c.JSON(http.StatusOK, categories)
}

func GetCategories(c *gin.Context) {
	respondWithCategories(c, false)
}

func AdminGetCategories(c *gin.Context) {
	respondWithCategories(c, true)
}

func CreateCategory(c *gin.Context) {
	var input createCategoryInput
	if !bindJSON(c, &input) {
		return
	}
	name, err := normalizeRequired(input.Name, "name", 50)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_name", err.Error())
		return
	}
	if err := validateOptionalLength(input.Description, "description", 10_000); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_description", err.Error())
		return
	}
	category := models.Category{Name: name, Description: input.Description}
	result := config.DB.Create(&category)
	if isUniqueViolation(result.Error) {
		apiresponse.Error(c, http.StatusConflict, "category_name_conflict", "A category with this name already exists")
		return
	}
	if result.Error != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not create category")
		return
	}
	c.JSON(http.StatusCreated, category)
}

func UpdateCategory(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input updateCategoryInput
	if !bindJSON(c, &input) {
		return
	}
	if input.Name == nil && input.Description == nil {
		apiresponse.Error(c, http.StatusBadRequest, "empty_update", "At least one category field is required")
		return
	}

	updates := map[string]any{}
	if input.Name != nil {
		name, err := normalizeRequired(*input.Name, "name", 50)
		if err != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_name", err.Error())
			return
		}
		updates["name"] = name
	}
	if input.Description != nil {
		if err := validateOptionalLength(*input.Description, "description", 10_000); err != nil {
			apiresponse.Error(c, http.StatusBadRequest, "invalid_description", err.Error())
			return
		}
		updates["description"] = *input.Description
	}

	result := config.DB.Model(&models.Category{}).Where("id = ?", id).Updates(updates)
	if isUniqueViolation(result.Error) {
		apiresponse.Error(c, http.StatusConflict, "category_name_conflict", "A category with this name already exists")
		return
	}
	if result.Error != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not update category")
		return
	}
	if result.RowsAffected == 0 {
		apiresponse.Error(c, http.StatusNotFound, "category_not_found", "Category not found")
		return
	}
	var category models.Category
	if err := config.DB.First(&category, id).Error; err != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Category was updated but could not be reloaded")
		return
	}
	c.JSON(http.StatusOK, category)
}

func DeleteCategory(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	result := config.DB.Delete(&models.Category{}, id)
	if result.Error != nil {
		apiresponse.Error(c, http.StatusInternalServerError, "database_error", "Could not delete category")
		return
	}
	if result.RowsAffected == 0 {
		apiresponse.Error(c, http.StatusNotFound, "category_not_found", "Category not found")
		return
	}
	apiresponse.Message(c, http.StatusOK, "Category deleted; related posts are now uncategorized")
}
