package handlers

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"blog-backend/internal/apiresponse"
	"blog-backend/internal/config"
	"blog-backend/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxHomepageLinks = 100

var linkRequestID = regexp.MustCompile(`^[a-zA-Z0-9-]{16,80}$`)
var linkHexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type linkInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	Visible     bool   `json:"visible"`
	Version     int64  `json:"version"`
	RequestID   string `json:"request_id"`
}

func validLinkInput(input *linkInput) bool {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.URL = strings.TrimSpace(input.URL)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 100 || utf8.RuneCountInString(input.Description) > 300 || len(input.URL) > 2048 {
		return false
	}
	switch input.Icon {
	case "star", "grid", "layout", "zap", "link", "code", "book", "globe":
	default:
		return false
	}
	switch input.Color {
	case "blue", "yellow", "green", "red":
	default:
		if !linkHexColor.MatchString(input.Color) {
			return false
		}
		input.Color = strings.ToLower(input.Color)
	}
	if input.URL == "" {
		return !input.Visible
	}
	if strings.ContainsAny(input.URL, "\\") || strings.IndexFunc(input.URL, unicode.IsSpace) >= 0 {
		return false
	}
	parsed, err := url.Parse(input.URL)
	return err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Hostname() != "" && parsed.User == nil
}

func GetLinks(c *gin.Context) {
	links := make([]models.Link, 0)
	if err := config.DB.WithContext(c.Request.Context()).Where("visible = ?", true).Order("position, id").Find(&links).Error; err != nil {
		apiresponse.Error(c, 500, "database_error", "Could not load links")
		return
	}
	// Public links are small and read afresh, so hiding a link takes effect on the next read.
	c.JSON(http.StatusOK, links)
}
func AdminGetLinks(c *gin.Context) {
	links := make([]models.Link, 0)
	if err := config.DB.WithContext(c.Request.Context()).Order("position, id").Find(&links).Error; err != nil {
		apiresponse.Error(c, 500, "database_error", "Could not load links")
		return
	}
	c.JSON(http.StatusOK, links)
}

type linkFailure struct {
	status        int
	code, message string
}

func (e *linkFailure) Error() string { return e.message }
func linkConflict() error {
	return &linkFailure{409, "link_conflict", "This link changed elsewhere. Reload links before trying again."}
}
func writeLinkError(c *gin.Context, err error) {
	var failure *linkFailure
	if errors.As(err, &failure) {
		apiresponse.Error(c, failure.status, failure.code, failure.message)
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		apiresponse.Error(c, 404, "link_not_found", "Link not found")
		return
	}
	apiresponse.Error(c, 500, "database_error", "Could not save link changes")
}

// Short administrator writes share one lock, keeping ordering, limits and retries atomic.
func linkTransaction(c *gin.Context, write func(*gorm.DB) error) error {
	return config.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("LOCK TABLE links IN SHARE ROW EXCLUSIVE MODE").Error; err != nil {
			return err
		}
		return write(tx)
	})
}
func CreateLink(c *gin.Context) {
	var input linkInput
	if !bindJSON(c, &input) {
		return
	}
	if !validLinkInput(&input) || !linkRequestID.MatchString(input.RequestID) {
		apiresponse.Error(c, 400, "invalid_link", "Check the title, description, URL, icon and color")
		return
	}
	var result models.Link
	err := linkTransaction(c, func(tx *gorm.DB) error {
		err := tx.Where("request_id = ?", input.RequestID).First(&result).Error
		if err == nil {
			if result.Title != input.Title || result.Description != input.Description || result.URL != input.URL || result.Icon != input.Icon || result.Color != input.Color || result.Visible != input.Visible {
				return linkConflict()
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&models.Link{}).Count(&count).Error; err != nil {
			return err
		}
		if count >= maxHomepageLinks {
			return &linkFailure{409, "link_limit", "Up to 100 homepage links can be stored. Delete an unused link first."}
		}
		var position int64
		if err := tx.Model(&models.Link{}).Select("COALESCE(MAX(position), 0)").Scan(&position).Error; err != nil {
			return err
		}
		result = models.Link{Title: input.Title, Description: input.Description, URL: input.URL, Icon: input.Icon, Color: input.Color, Visible: input.Visible, Position: position + 1, Version: 1, RequestID: input.RequestID}
		return tx.Create(&result).Error
	})
	if err != nil {
		writeLinkError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}
func UpdateLink(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input linkInput
	if !bindJSON(c, &input) {
		return
	}
	if !validLinkInput(&input) || input.Version < 1 {
		apiresponse.Error(c, 400, "invalid_link", "Check the link fields and version")
		return
	}
	var result models.Link
	err := linkTransaction(c, func(tx *gorm.DB) error {
		if err := tx.First(&result, id).Error; err != nil {
			return err
		}
		if result.Version != input.Version {
			return linkConflict()
		}
		if err := tx.Model(&result).Updates(map[string]any{"title": input.Title, "description": input.Description, "url": input.URL, "icon": input.Icon, "color": input.Color, "visible": input.Visible, "version": result.Version + 1}).Error; err != nil {
			return err
		}
		return tx.First(&result, id).Error
	})
	if err != nil {
		writeLinkError(c, err)
		return
	}
	c.JSON(200, result)
}
func DeleteLink(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input struct {
		Version int64 `json:"version"`
	}
	if !bindJSON(c, &input) {
		return
	}
	if input.Version < 1 {
		apiresponse.Error(c, 400, "invalid_version", "A current version is required")
		return
	}
	err := linkTransaction(c, func(tx *gorm.DB) error {
		var link models.Link
		if err := tx.First(&link, id).Error; err != nil {
			return err
		}
		if link.Version != input.Version {
			return linkConflict()
		}
		return tx.Delete(&link).Error
	})
	if err != nil {
		writeLinkError(c, err)
		return
	}
	apiresponse.Message(c, 200, "Link deleted")
}
func MoveLink(c *gin.Context) {
	id, ok := parseResourceID(c)
	if !ok {
		return
	}
	var input struct {
		Version         int64 `json:"version"`
		NeighborID      uint  `json:"neighbor_id"`
		NeighborVersion int64 `json:"neighbor_version"`
	}
	if !bindJSON(c, &input) {
		return
	}
	if input.Version < 1 || input.NeighborVersion < 1 || input.NeighborID == id {
		apiresponse.Error(c, 400, "invalid_move", "Two adjacent links and their versions are required")
		return
	}
	var links []models.Link
	err := linkTransaction(c, func(tx *gorm.DB) error {
		if err := tx.Order("position, id").Find(&links).Error; err != nil {
			return err
		}
		a, b := -1, -1
		for i, link := range links {
			if link.ID == id {
				a = i
			}
			if link.ID == input.NeighborID {
				b = i
			}
		}
		if a < 0 || b < 0 {
			return gorm.ErrRecordNotFound
		}
		if (a-b != 1 && b-a != 1) || links[a].Version != input.Version || links[b].Version != input.NeighborVersion {
			return linkConflict()
		}
		first, second := links[a], links[b]
		if err := tx.Model(&first).Updates(map[string]any{"position": second.Position, "version": first.Version + 1}).Error; err != nil {
			return err
		}
		if err := tx.Model(&second).Updates(map[string]any{"position": links[a].Position, "version": second.Version + 1}).Error; err != nil {
			return err
		}
		return tx.Order("position, id").Find(&links).Error
	})
	if err != nil {
		writeLinkError(c, err)
		return
	}
	c.JSON(200, links)
}
