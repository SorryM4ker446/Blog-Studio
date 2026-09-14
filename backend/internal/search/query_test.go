package search

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type resultDriver struct{}
type resultConnection struct{ scenario string }
type resultRows struct {
	scenario string
	sent     bool
}

func (resultDriver) Open(name string) (driver.Conn, error) { return resultConnection{name}, nil }
func (resultConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (resultConnection) Close() error              { return nil }
func (resultConnection) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (c resultConnection) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if c.scenario == "database error" {
		return nil, errors.New("query unavailable")
	}
	return &resultRows{scenario: c.scenario}, nil
}
func (*resultRows) Columns() []string {
	return []string{"total", "posts_total", "files_total", "posts", "files"}
}
func (*resultRows) Close() error { return nil }
func (r *resultRows) Next(values []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	values[0], values[1], values[2] = int64(0), int64(0), int64(0)
	values[3], values[4] = "[]", "[]"
	if r.scenario == "invalid posts" {
		values[3] = "{"
	}
	if r.scenario == "invalid files" {
		values[4] = "{"
	}
	return nil
}

func init() { sql.Register("search-result-contract", resultDriver{}) }

func TestReadRejectsInvalidDatabaseResults(t *testing.T) {
	for _, scenario := range []string{"database error", "invalid posts", "invalid files", "empty"} {
		t.Run(scenario, func(t *testing.T) {
			connection, err := sql.Open("search-result-contract", scenario)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			db, err := gorm.Open(postgres.New(postgres.Config{Conn: connection}), &gorm.Config{DisableAutomaticPing: true})
			if err != nil {
				t.Fatal(err)
			}
			result, err := Read(db, Options{Query: "needle", Scope: "all", Page: 7, Limit: 10})
			if (err != nil) != (scenario != "empty") {
				t.Fatalf("unexpected result error: %v", err)
			}
			if result.Page != 7 || result.Limit != 10 {
				t.Fatalf("lost requested pagination: %+v", result)
			}
			if scenario == "empty" && (result.Posts == nil || result.Files == nil || result.Total != 0) {
				t.Fatalf("invalid empty result: %+v", result)
			}
		})
	}
}
