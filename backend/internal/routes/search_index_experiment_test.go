package routes

import (
	"blog-backend/internal/search"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestSearchIndexWriteMaintenance(t *testing.T) {
	output := os.Getenv("SEARCH_INDEX_EXPERIMENT_OUTPUT")
	if output == "" {
		t.Skip("set SEARCH_INDEX_EXPERIMENT_OUTPUT to compare index maintenance options")
	}
	db := openReadAnalysisDatabase(t)
	// Compare PostgreSQL's default queue after the same batched writes.
	analysisExec(t, db, "ALTER INDEX idx_posts_search_text SET (fastupdate=on, gin_pending_list_limit=4096)")
	fixture := seedReadAnalysis(t, db, 2400)
	sql, args := search.Query(search.Options{Query: "needlequartz", Scope: "posts", Page: 1, Limit: 10})
	query := analysisQuery{"public-rare-body", sql, args}
	report := queryAnalysisReport{FixtureVersion: "long-body-v1", Posts: fixture.Posts, Files: fixture.Files, BodyBytes: fixture.BodyBytes, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	report.Baseline = append(report.Baseline, measureAnalysisQuery(t, db, query))
	for _, option := range []string{"fastupdate=off", "gin_pending_list_limit=64", "gin_pending_list_limit=256"} {
		analysisExec(t, db, "SAVEPOINT index_option")
		analysisExec(t, db, "DROP INDEX idx_posts_search_text")
		ddl := "CREATE INDEX idx_posts_search_text ON posts USING gin(search_text public.gin_trgm_ops) WITH (" + option + ")"
		started := time.Now()
		analysisExec(t, db, ddl)
		experiment := analysisExperiment{Name: option, DDL: ddl, BuildMS: elapsedMS(started)}
		experiment.WriteMedianMS = measureAnalysisWrite(t, db, "UPDATE posts SET search_text=search_text||' changed' WHERE id BETWEEN 1 AND 100")
		experiment.Queries = append(experiment.Queries, measureAnalysisQuery(t, db, query))
		db.Raw("SELECT pg_relation_size('idx_posts_search_text'::regclass)").Scan(&experiment.IndexBytes)
		report.Experiments = append(report.Experiments, experiment)
		analysisExec(t, db, "ROLLBACK TO SAVEPOINT index_option")
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, encoded, 0600); err != nil {
		t.Fatal("write search index report")
	}
}
