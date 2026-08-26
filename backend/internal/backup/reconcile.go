package backup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"blog-backend/internal/filestore"
	"gorm.io/gorm"
)

type StorageReport struct {
	MissingRecordIDs []uint
	OrphanKeys       []string
}

type storageRecord struct {
	ID   uint
	Name string
	Path string
}

func CheckStorageConsistency(db *gorm.DB, uploadDir string) (StorageReport, error) {
	if db == nil {
		return StorageReport{}, errors.New("database connection is required")
	}
	info, err := os.Stat(uploadDir)
	if err != nil {
		return StorageReport{}, fmt.Errorf("inspect upload directory: %w", err)
	}
	if !info.IsDir() {
		return StorageReport{}, errors.New("upload path is not a directory")
	}
	store, err := filestore.NewLocalStore(uploadDir)
	if err != nil {
		return StorageReport{}, err
	}
	keys, err := store.ListKeys()
	if err != nil {
		return StorageReport{}, fmt.Errorf("list stored uploads: %w", err)
	}
	available := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		available[key] = struct{}{}
	}

	var records []storageRecord
	if err := db.Table("files").Select("id", "name", "path").Order("id ASC").Find(&records).Error; err != nil {
		return StorageReport{}, fmt.Errorf("load file records: %w", err)
	}
	used := make(map[string]struct{}, len(records))
	report := StorageReport{}
	for _, record := range records {
		candidates := []string{strings.TrimSpace(record.Name)}
		if base := strings.TrimSpace(filepath.Base(record.Path)); base != "" && base != "." && base != string(filepath.Separator) {
			candidates = append(candidates, base)
		}
		found := false
		for _, candidate := range candidates {
			if _, exists := available[candidate]; !exists {
				continue
			}
			if _, alreadyUsed := used[candidate]; alreadyUsed {
				continue
			}
			used[candidate] = struct{}{}
			found = true
			break
		}
		if !found {
			report.MissingRecordIDs = append(report.MissingRecordIDs, record.ID)
		}
	}
	for _, key := range keys {
		if _, exists := used[key]; !exists {
			report.OrphanKeys = append(report.OrphanKeys, key)
		}
	}
	sort.Slice(report.MissingRecordIDs, func(i, j int) bool { return report.MissingRecordIDs[i] < report.MissingRecordIDs[j] })
	sort.Strings(report.OrphanKeys)
	return report, nil
}

func (report StorageReport) IsClean() bool {
	return len(report.MissingRecordIDs) == 0 && len(report.OrphanKeys) == 0
}

func (report StorageReport) Error() error {
	if report.IsClean() {
		return nil
	}
	return fmt.Errorf(
		"storage is inconsistent: %d database records are missing content and %d stored files are orphaned",
		len(report.MissingRecordIDs),
		len(report.OrphanKeys),
	)
}
