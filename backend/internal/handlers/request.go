package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"blog-backend/internal/apiresponse"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	maxPage        = 1_000_000
	maxPageLimit   = 100
	maxSearchRunes = 200
)

func bindJSON(c *gin.Context, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON object")
		return false
	}
	return true
}

func parseResourceID(c *gin.Context) (uint, bool) {
	value, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || value == 0 || value > math.MaxInt64 {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_id", "Resource ID must be a positive integer")
		return 0, false
	}
	return uint(value), true
}

func parsePagination(c *gin.Context) (int, int, bool) {
	page, err := parseBoundedInt(c.DefaultQuery("page", "1"), 1, maxPage)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_page", fmt.Sprintf("page must be between 1 and %d", maxPage))
		return 0, 0, false
	}
	limit, err := parseBoundedInt(c.DefaultQuery("limit", "10"), 1, maxPageLimit)
	if err != nil {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_limit", fmt.Sprintf("limit must be between 1 and %d", maxPageLimit))
		return 0, 0, false
	}
	return page, limit, true
}

func parseBoundedInt(raw string, minimum, maximum int) (int, error) {
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || value < int64(minimum) || value > int64(maximum) {
		return 0, errors.New("integer is outside the allowed range")
	}
	return int(value), nil
}

func parseCategoryFilter(c *gin.Context) (*uint, bool) {
	raw := strings.TrimSpace(c.Query("category_id"))
	if raw == "" {
		return nil, true
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value > math.MaxInt64 {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_category_id", "category_id must be a non-negative integer")
		return nil, false
	}
	categoryID := uint(value)
	return &categoryID, true
}

func normalizeRequired(value, field string, maximum int) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	if utf8.RuneCountInString(normalized) > maximum {
		return "", fmt.Errorf("%s must not exceed %d characters", field, maximum)
	}
	return normalized, nil
}

func validateOptionalLength(value, field string, maximum int) error {
	if utf8.RuneCountInString(value) > maximum {
		return fmt.Errorf("%s must not exceed %d characters", field, maximum)
	}
	return nil
}

func validatePostStatus(status string) error {
	if status != "draft" && status != "published" {
		return errors.New("status must be either draft or published")
	}
	return nil
}

func validateSearchQuery(c *gin.Context) (string, bool) {
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		apiresponse.Error(c, http.StatusBadRequest, "missing_query", "Query parameter 'q' is required")
		return "", false
	}
	if utf8.RuneCountInString(query) > maxSearchRunes {
		apiresponse.Error(c, http.StatusBadRequest, "invalid_query", fmt.Sprintf("q must not exceed %d characters", maxSearchRunes))
		return "", false
	}
	return query, true
}

func isPostgresError(err error, code string) bool {
	var pgError *pgconn.PgError
	return errors.As(err, &pgError) && pgError.Code == code
}

func isUniqueViolation(err error) bool {
	return isPostgresError(err, "23505")
}

func isConstraintViolation(err error) bool {
	return isPostgresError(err, "23503") || isPostgresError(err, "23514") || isPostgresError(err, "22001")
}

func safeOffset(page, limit int) int {
	offset := int64(page-1) * int64(limit)
	if offset > int64(math.MaxInt) {
		return math.MaxInt
	}
	return int(offset)
}
