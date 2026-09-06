package routes

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"blog-backend/internal/search"
)

func TestSearchQueryPlans(t *testing.T) {
	output := os.Getenv("SEARCH_QUERY_ANALYSIS_OUTPUT")
	if output == "" {
		t.Skip("set SEARCH_QUERY_ANALYSIS_OUTPUT to inspect implemented search and read indexes")
	}
	db := openReadAnalysisDatabase(t)
	t.Log("seeding long-body articles with the production text extractor and indexes")
	fixture := seedReadAnalysis(t, db, 2400)
	report := queryAnalysisReport{FixtureVersion: "long-body-v1", CreatedAt: time.Now().UTC().Format(time.RFC3339), Posts: fixture.Posts, Files: fixture.Files, Categories: fixture.Categories, BodyBytes: fixture.BodyBytes}
	var server string
	if err := db.Raw("SELECT current_setting('server_version')").Scan(&server).Error; err != nil {
		t.Fatal(err)
	}
	report.Environment = map[string]any{"postgresql": server, "samples_per_query": 3, "transaction_disposition": "rollback-only", "extractor": "application searchtext.Extract"}
	var queries []analysisQuery
	for _, admin := range []bool{false, true} {
		for _, scope := range []string{"posts", "files", "all"} {
			for _, q := range []string{"needlequartz", "article", "中", "hiddenneedle"} {
				options := search.Options{Query: q, Scope: scope, Admin: admin, Page: 1, Limit: 10}
				sql, args := search.Query(options)
				queries = append(queries, analysisQuery{fmt.Sprintf("admin-%t/%s/%s", admin, scope, q), sql, args})
			}
		}
	}
	for _, q := range queries {
		measurement := measureAnalysisQuery(t, db, q)
		report.Baseline = append(report.Baseline, measurement)
		if q.Name == "admin-false/posts/needlequartz" && !strings.Contains(string(measurement.Samples[0]), "idx_posts_search_text") {
			t.Error("rare body query no longer uses the verified trigram index")
		}
	}
	for _, q := range baselineAnalysisQueries() {
		if strings.Contains(q.Name, "search") {
			continue
		}
		q.SQL = strings.Replace(q.SQL, "SELECT p.*", "SELECT "+analysisPostColumns, 1)
		report.Baseline = append(report.Baseline, measureAnalysisQuery(t, db, q))
	}
	for _, index := range []struct{ name, write string }{
		{"idx_posts_search_text", `UPDATE posts SET search_text=search_text||' changed' WHERE id BETWEEN 1 AND 100`},
		{"idx_posts_admin_order", `UPDATE posts SET updated_at=updated_at+interval '1 second' WHERE id BETWEEN 1 AND 100`},
		{"idx_files_public_order", `UPDATE files SET created_at=created_at+interval '1 second' WHERE id BETWEEN 1 AND 100`},
	} {
		experiment := analysisExperiment{Name: index.name, WriteMedianMS: measureAnalysisWrite(t, db, index.write)}
		if err := db.Raw("SELECT pg_relation_size(?::regclass)", index.name).Scan(&experiment.IndexBytes).Error; err != nil {
			t.Fatal(err)
		}
		analysisExec(t, db, "SAVEPOINT measured_index")
		analysisExec(t, db, "DROP INDEX "+index.name)
		experiment.BaselineWriteMedianMS = measureAnalysisWrite(t, db, index.write)
		if index.name == "idx_posts_search_text" {
			experiment.Queries = append(experiment.Queries, measureAnalysisQuery(t, db, queries[0]))
		}
		analysisExec(t, db, "ROLLBACK TO SAVEPOINT measured_index")
		report.Experiments = append(report.Experiments, experiment)
	}
	report.ContractChecks = []string{"actual API search SQL measured with ANALYZE and BUFFERS", "rare body query uses idx_posts_search_text", "only verified application indexes retained", "all fixture data rolled back"}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, append(encoded, '\n'), 0600); err != nil {
		t.Fatal("write implemented-query report")
	}
	t.Logf("recorded %d production queries and %d index write comparisons", len(report.Baseline), len(report.Experiments))
}
