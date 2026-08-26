package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	ManifestFileName      = "manifest.json"
	DatabaseFileName      = "database.dump"
	UploadsFileName       = "uploads.tar.gz"
	currentManifestFormat = 1
)

type Artifact struct {
	File   string `json:"file"`
	Format string `json:"format"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type UploadArtifact struct {
	Artifact
	FileCount        int   `json:"file_count"`
	UncompressedSize int64 `json:"uncompressed_size"`
}

type Manifest struct {
	FormatVersion    int            `json:"format_version"`
	CreatedAt        time.Time      `json:"created_at"`
	MigrationVersion int64          `json:"migration_version"`
	Database         Artifact       `json:"database"`
	Uploads          UploadArtifact `json:"uploads"`
}

type CommandRunner interface {
	Run(ctx context.Context, executable string, args []string, environment []string) error
}

type CreateOptions struct {
	DatabaseDSN      string
	UploadDir        string
	OutputDir        string
	MigrationVersion int64
	PgDumpPath       string
	Runner           CommandRunner
	Now              func() time.Time
}

func Create(ctx context.Context, options CreateOptions) (string, error) {
	if strings.TrimSpace(options.DatabaseDSN) == "" {
		return "", errors.New("database DSN is required")
	}
	if strings.TrimSpace(options.UploadDir) == "" {
		return "", errors.New("upload directory is required")
	}
	if strings.TrimSpace(options.OutputDir) == "" {
		return "", errors.New("backup output directory is required")
	}
	if options.MigrationVersion <= 0 {
		return "", errors.New("migration version is required")
	}
	if options.PgDumpPath == "" {
		options.PgDumpPath = "pg_dump"
	}
	if options.Runner == nil {
		options.Runner = ExecRunner{}
	}
	if options.Now == nil {
		options.Now = time.Now
	}

	outputDir, err := filepath.Abs(options.OutputDir)
	if err != nil {
		return "", fmt.Errorf("resolve backup output directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return "", fmt.Errorf("create backup output directory: %w", err)
	}
	stagingDir, err := os.MkdirTemp(outputDir, ".blog-studio-backup-")
	if err != nil {
		return "", fmt.Errorf("create backup staging directory: %w", err)
	}
	keepStaging := false
	defer func() {
		if !keepStaging {
			_ = os.RemoveAll(stagingDir)
		}
	}()

	databasePath := filepath.Join(stagingDir, DatabaseFileName)
	dumpArgs := []string{
		"--format=custom",
		"--compress=9",
		"--no-owner",
		"--no-privileges",
		"--no-password",
		"--file=" + databasePath,
	}
	postgresEnv, err := postgresEnvironment(options.DatabaseDSN)
	if err != nil {
		return "", err
	}
	if err := options.Runner.Run(ctx, options.PgDumpPath, dumpArgs, postgresEnv); err != nil {
		return "", fmt.Errorf("create PostgreSQL dump: %w", err)
	}

	uploadsPath := filepath.Join(stagingDir, UploadsFileName)
	fileCount, uncompressedSize, err := createUploadArchive(options.UploadDir, uploadsPath)
	if err != nil {
		return "", err
	}
	databaseArtifact, err := inspectArtifact(databasePath, DatabaseFileName, "postgresql-custom")
	if err != nil {
		return "", err
	}
	uploadArtifact, err := inspectArtifact(uploadsPath, UploadsFileName, "tar+gzip")
	if err != nil {
		return "", err
	}
	manifest := Manifest{
		FormatVersion:    currentManifestFormat,
		CreatedAt:        options.Now().UTC(),
		MigrationVersion: options.MigrationVersion,
		Database:         databaseArtifact,
		Uploads: UploadArtifact{
			Artifact:         uploadArtifact,
			FileCount:        fileCount,
			UncompressedSize: uncompressedSize,
		},
	}
	if err := writeManifest(filepath.Join(stagingDir, ManifestFileName), manifest); err != nil {
		return "", err
	}
	if _, err := Verify(stagingDir); err != nil {
		return "", fmt.Errorf("verify staged backup: %w", err)
	}

	bundleName := "blog-studio-backup-" + manifest.CreatedAt.Format("20060102T150405Z")
	finalDir := filepath.Join(outputDir, bundleName)
	if _, err := os.Lstat(finalDir); err == nil {
		return "", fmt.Errorf("backup destination already exists: %s", bundleName)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect backup destination: %w", err)
	}
	if err := os.Rename(stagingDir, finalDir); err != nil {
		return "", fmt.Errorf("publish backup bundle: %w", err)
	}
	keepStaging = true
	return finalDir, nil
}

func Verify(bundleDir string) (Manifest, error) {
	bundleDir, err := filepath.Abs(strings.TrimSpace(bundleDir))
	if err != nil {
		return Manifest{}, fmt.Errorf("resolve backup bundle: %w", err)
	}
	manifest, err := readManifest(filepath.Join(bundleDir, ManifestFileName))
	if err != nil {
		return Manifest{}, err
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	if err := verifyArtifact(bundleDir, manifest.Database); err != nil {
		return Manifest{}, fmt.Errorf("verify database artifact: %w", err)
	}
	if err := verifyArtifact(bundleDir, manifest.Uploads.Artifact); err != nil {
		return Manifest{}, fmt.Errorf("verify uploads artifact: %w", err)
	}
	fileCount, uncompressedSize, err := inspectUploadArchive(filepath.Join(bundleDir, manifest.Uploads.File), nil)
	if err != nil {
		return Manifest{}, fmt.Errorf("verify uploads archive: %w", err)
	}
	if fileCount != manifest.Uploads.FileCount || uncompressedSize != manifest.Uploads.UncompressedSize {
		return Manifest{}, errors.New("uploads archive contents do not match the manifest")
	}
	return manifest, nil
}

func VerifyDatabaseArchive(ctx context.Context, bundleDir, pgRestorePath string, runner CommandRunner) error {
	manifest, err := Verify(bundleDir)
	if err != nil {
		return err
	}
	if pgRestorePath == "" {
		pgRestorePath = "pg_restore"
	}
	if runner == nil {
		runner = ExecRunner{}
	}
	databasePath := filepath.Join(bundleDir, manifest.Database.File)
	if err := runner.Run(ctx, pgRestorePath, []string{"--no-password", "--list", databasePath}, os.Environ()); err != nil {
		return fmt.Errorf("inspect PostgreSQL archive: %w", err)
	}
	return nil
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, executable string, args []string, environment []string) error {
	command := exec.CommandContext(ctx, executable, args...)
	command.Env = environment
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 4096 {
		detail = detail[:4096]
	}
	if detail == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, detail)
}

func postgresEnvironment(dsn string) ([]string, error) {
	parsed, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL DSN: %w", err)
	}
	overrides := map[string]string{
		"PGHOST":     parsed.Host,
		"PGPORT":     strconv.FormatUint(uint64(parsed.Port), 10),
		"PGUSER":     parsed.User,
		"PGDATABASE": parsed.Database,
	}
	if parsed.Password != "" {
		overrides["PGPASSWORD"] = parsed.Password
	}
	if parsed.TLSConfig == nil {
		overrides["PGSSLMODE"] = "disable"
	} else if parsed.TLSConfig.InsecureSkipVerify {
		overrides["PGSSLMODE"] = "require"
	} else {
		overrides["PGSSLMODE"] = "verify-full"
	}
	environment := make([]string, 0, len(os.Environ())+len(overrides))
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		remove := false
		for override := range overrides {
			if strings.EqualFold(name, override) {
				remove = true
				break
			}
		}
		if !remove {
			environment = append(environment, entry)
		}
	}
	for name, value := range overrides {
		environment = append(environment, name+"="+value)
	}
	return environment, nil
}

func inspectArtifact(path, name, format string) (Artifact, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return Artifact{}, fmt.Errorf("inspect %s: %w", name, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return Artifact{}, fmt.Errorf("%s is not a regular file", name)
	}
	hash, err := fileSHA256(path)
	if err != nil {
		return Artifact{}, fmt.Errorf("checksum %s: %w", name, err)
	}
	return Artifact{File: name, Format: format, Size: info.Size(), SHA256: hash}, nil
}

func verifyArtifact(bundleDir string, artifact Artifact) error {
	path := filepath.Join(bundleDir, artifact.File)
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("artifact is not a regular file")
	}
	if info.Size() != artifact.Size {
		return fmt.Errorf("size is %d, expected %d", info.Size(), artifact.Size)
	}
	hash, err := fileSHA256(path)
	if err != nil {
		return err
	}
	if hash != artifact.SHA256 {
		return errors.New("SHA-256 checksum does not match")
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeManifest(path string, manifest Manifest) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create backup manifest: %w", err)
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(manifest)
	if encodeErr == nil {
		encodeErr = file.Sync()
	}
	closeErr := file.Close()
	if encodeErr != nil {
		return fmt.Errorf("write backup manifest: %w", encodeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close backup manifest: %w", closeErr)
	}
	return nil
}

func readManifest(path string) (Manifest, error) {
	file, err := os.Open(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("open backup manifest: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode backup manifest: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return Manifest{}, errors.New("backup manifest contains trailing data")
	}
	return manifest, nil
}

func validateManifest(manifest Manifest) error {
	if manifest.FormatVersion != currentManifestFormat {
		return fmt.Errorf("unsupported backup format version %d", manifest.FormatVersion)
	}
	if manifest.CreatedAt.IsZero() || manifest.MigrationVersion <= 0 {
		return errors.New("backup manifest metadata is incomplete")
	}
	if err := validateArtifact(manifest.Database, DatabaseFileName, "postgresql-custom"); err != nil {
		return fmt.Errorf("invalid database artifact: %w", err)
	}
	if err := validateArtifact(manifest.Uploads.Artifact, UploadsFileName, "tar+gzip"); err != nil {
		return fmt.Errorf("invalid uploads artifact: %w", err)
	}
	if manifest.Uploads.FileCount < 0 || manifest.Uploads.UncompressedSize < 0 {
		return errors.New("uploads archive counts must not be negative")
	}
	return nil
}

func validateArtifact(artifact Artifact, expectedFile, expectedFormat string) error {
	if artifact.File != expectedFile || artifact.Format != expectedFormat {
		return errors.New("file name or format is unexpected")
	}
	if artifact.Size < 0 {
		return errors.New("artifact size must not be negative")
	}
	if len(artifact.SHA256) != sha256.Size*2 {
		return errors.New("SHA-256 checksum has an invalid length")
	}
	decoded, err := hex.DecodeString(artifact.SHA256)
	if err != nil || len(decoded) != sha256.Size || strings.ToLower(artifact.SHA256) != artifact.SHA256 {
		return errors.New("SHA-256 checksum is invalid")
	}
	return nil
}
