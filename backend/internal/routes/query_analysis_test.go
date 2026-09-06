package routes

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type analysisQuery struct {
	Name string
	SQL  string
	Args []any
}
type analysisMeasurement struct {
	Name     string
	SQL      string
	Args     []any
	MedianMS float64
	Samples  []json.RawMessage
}
type analysisExperiment struct {
	Name                  string
	DDL                   string
	BuildMS               float64
	IndexBytes            int64
	WriteMedianMS         float64
	BaselineWriteMedianMS float64
	Queries               []analysisMeasurement
}
type queryAnalysisReport struct {
	FixtureVersion   string
	CreatedAt        string
	Environment      map[string]any
	Posts            int
	Files            int
	Categories       int
	BodyBytes        int
	Baseline         []analysisMeasurement
	Experiments      []analysisExperiment
	ContractChecks   []string
	ExtensionOutcome string
}

const analysisTimeline = "COALESCE(p.last_edited_at, p.published_at) DESC, p.id DESC"
const analysisPostColumns = "p.id, p.title, p.slug, p.summary, p.category_id, p.status, p.published_at, p.last_edited_at, p.created_at, p.updated_at"
const analysisFileName = "COALESCE(NULLIF(BTRIM(f.display_name), ''), f.orig_name)"

func TestQueryAnalysis(t *testing.T) {
	output := os.Getenv("QUERY_ANALYSIS_OUTPUT")
	if output == "" {
		t.Skip("set QUERY_ANALYSIS_OUTPUT to record isolated PostgreSQL query experiments")
	}
	db := openReadAnalysisDatabase(t)
	t.Log("seeding the isolated long-body fixture")
	fixture := seedReadAnalysis(t, db, 2400)
	// Keep the historical experiment reproducible after the application adopts its selected indexes.
	analysisExec(t, db, "DROP INDEX idx_posts_search_text, idx_posts_admin_order, idx_files_public_order")
	analysisExec(t, db, "ALTER TABLE posts DROP COLUMN search_text")
	report := queryAnalysisReport{
		FixtureVersion: "long-body-v1", CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Posts: fixture.Posts, Files: fixture.Files, Categories: fixture.Categories, BodyBytes: fixture.BodyBytes,
	}
	var facts struct {
		ServerVersion      string
		Collation          string
		Ctype              string
		CanCreateExtension bool
		Superuser          bool
		ExtensionAvailable bool
		ExtensionInstalled bool
	}
	err := db.Raw("SELECT current_setting('server_version') AS server_version, d.datcollate AS collation, d.datctype AS ctype, has_database_privilege(current_database(), 'CREATE') AS can_create_extension, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_trgm') AS extension_available, EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') AS extension_installed FROM pg_database d WHERE d.datname=current_database()").Scan(&facts).Error
	if err != nil {
		t.Fatal("could not inspect query analysis environment")
	}
	report.Environment = map[string]any{
		"postgresql": facts.ServerVersion, "collation": facts.Collation, "ctype": facts.Ctype,
		"connection_role_has_database_create": facts.CanCreateExtension, "connection_role_is_superuser": facts.Superuser,
		"pg_trgm_available": facts.ExtensionAvailable, "pg_trgm_preinstalled": facts.ExtensionInstalled,
		"transaction_disposition": "rollback-only", "samples_per_query": 3,
	}
	baseline := baselineAnalysisQueries()
	t.Log("measuring current list, count and search SQL")
	for _, query := range baseline {
		report.Baseline = append(report.Baseline, measureAnalysisQuery(t, db, query))
	}

	for _, candidate := range []struct {
		name, ddl, index string
		queries          []analysisQuery
	}{
		{"category-timeline", "CREATE INDEX analysis_category_timeline ON posts (category_id, (COALESCE(last_edited_at, published_at)) DESC, id DESC) WHERE status = 'published'", "analysis_category_timeline", baseline[4:10]},
		{"administrator-order", "CREATE INDEX analysis_admin_order ON posts ((CASE WHEN status = 'draft' THEN 1 ELSE 2 END), updated_at DESC, id DESC)", "analysis_admin_order", baseline[10:13]},
		{"public-file-order", "CREATE INDEX analysis_file_order ON files (created_at DESC, id DESC) WHERE is_system IS NOT TRUE", "analysis_file_order", baseline[13:17]},
	} {
		candidate.queries = append([]analysisQuery(nil), candidate.queries...)
		for _, query := range candidate.queries {
			if strings.HasPrefix(query.SQL, "SELECT p.*") {
				query.Name = "summary-" + query.Name
				query.SQL = strings.Replace(query.SQL, "SELECT p.*", "SELECT "+analysisPostColumns, 1)
				report.Baseline = append(report.Baseline, measureAnalysisQuery(t, db, query))
				candidate.queries = append(candidate.queries, query)
			}
		}
		writeSQL := "UPDATE posts SET updated_at = updated_at + interval '1 second' WHERE id BETWEEN 1 AND 100"
		if candidate.name == "category-timeline" {
			writeSQL = "UPDATE posts SET last_edited_at = COALESCE(last_edited_at, published_at) + interval '1 second' WHERE id BETWEEN 1 AND 100 AND status='published'"
		}
		if candidate.name == "public-file-order" {
			writeSQL = "UPDATE files SET created_at = created_at + interval '1 second' WHERE id BETWEEN 1 AND 100"
		}
		baselineWrite := measureAnalysisWrite(t, db, writeSQL)
		analysisExec(t, db, "SAVEPOINT candidate_index")
		started := time.Now()
		analysisExec(t, db, candidate.ddl)
		experiment := analysisExperiment{Name: candidate.name, DDL: candidate.ddl, BuildMS: elapsedMS(started), BaselineWriteMedianMS: baselineWrite}
		if err := db.Raw("SELECT pg_relation_size(?::regclass)", candidate.index).Scan(&experiment.IndexBytes).Error; err != nil {
			t.Fatal("could not measure candidate index")
		}
		for _, query := range candidate.queries {
			experiment.Queries = append(experiment.Queries, measureAnalysisQuery(t, db, query))
		}
		experiment.WriteMedianMS = measureAnalysisWrite(t, db, writeSQL)
		report.Experiments = append(report.Experiments, experiment)
		analysisExec(t, db, "ROLLBACK TO SAVEPOINT candidate_index")
	}

	t.Log("measuring summary projection and normalized search prototypes")
	analysisExec(t, db, "ALTER TABLE posts ADD COLUMN analysis_search_text text")
	for start := 0; start < len(fixture.SearchTexts); start += 32 {
		sql := "UPDATE posts p SET analysis_search_text = v.body FROM (VALUES "
		args := []any{}
		for i := start; i < min(start+32, len(fixture.SearchTexts)); i++ {
			if i > start {
				sql += ", "
			}
			sql += "(?::bigint, ?::text)"
			args = append(args, i+1, fixture.SearchTexts[i])
		}
		sql += ") AS v(id,body) WHERE p.id=v.id"
		analysisExec(t, db, sql, args...)
	}
	fixture.SearchTexts = nil
	analysisExec(t, db, "ANALYZE posts")
	prototype := prototypeAnalysisQueries()
	scan := analysisExperiment{Name: "normalized-without-extra-index"}
	for _, query := range prototype {
		scan.Queries = append(scan.Queries, measureAnalysisQuery(t, db, query))
	}
	scan.WriteMedianMS = measureAnalysisWrite(t, db, "UPDATE posts SET analysis_search_text = analysis_search_text || ' changed' WHERE id BETWEEN 1 AND 100")
	report.Experiments = append(report.Experiments, scan)
	verifyAnalysisSearchContract(t, db)
	report.ContractChecks = []string{
		"mixed pages share one SQL snapshot and contain at most 10 combined resources",
		"totals equal all matching public resources, including on an empty page",
		"equal timestamps have deterministic kind/ID ordering without duplicate page entries",
		"public results exclude drafts and system files",
		"fixture hidden link/image metadata does not match normalized search text",
	}

	report.ExtensionOutcome = "pg_trgm unavailable; measured the no-extension prototype"
	if facts.ExtensionAvailable {
		analysisExec(t, db, "SAVEPOINT extension_probe")
		err := db.Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm").Error
		if err != nil {
			analysisExec(t, db, "ROLLBACK TO SAVEPOINT extension_probe")
			code := "unknown"
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) {
				code = pgErr.Code
			}
			report.ExtensionOutcome = "extension probe failed with SQLSTATE " + code
		} else {
			analysisExec(t, db, "RELEASE SAVEPOINT extension_probe")
			report.ExtensionOutcome = "pg_trgm usable in isolated transaction; any new extension is rolled back"
			started := time.Now()
			ddl := "CREATE INDEX analysis_search_trgm ON posts USING gin (analysis_search_text gin_trgm_ops)"
			analysisExec(t, db, ddl)
			indexed := analysisExperiment{Name: "normalized-trigram", DDL: ddl, BuildMS: elapsedMS(started), BaselineWriteMedianMS: scan.WriteMedianMS}
			if err := db.Raw("SELECT pg_relation_size('analysis_search_trgm'::regclass)").Scan(&indexed.IndexBytes).Error; err != nil {
				t.Fatal("could not measure trigram index")
			}
			for _, query := range prototype {
				indexed.Queries = append(indexed.Queries, measureAnalysisQuery(t, db, query))
			}
			indexed.WriteMedianMS = measureAnalysisWrite(t, db, "UPDATE posts SET analysis_search_text = analysis_search_text || ' changed' WHERE id BETWEEN 1 AND 100")
			report.Experiments = append(report.Experiments, indexed)
			verifyAnalysisSearchContract(t, db)

			analysisExec(t, db, "SAVEPOINT file_search_index")
			fileWrite := "UPDATE files SET display_name = display_name || ' changed' WHERE id BETWEEN 1 AND 100"
			fileBaselineWrite := measureAnalysisWrite(t, db, fileWrite)
			started = time.Now()
			ddl = "CREATE INDEX analysis_file_trgm ON files USING gin ((COALESCE(NULLIF(BTRIM(display_name), ''), orig_name)) gin_trgm_ops)"
			analysisExec(t, db, ddl)
			fileIndex := analysisExperiment{Name: "file-name-trigram", DDL: ddl, BuildMS: elapsedMS(started), BaselineWriteMedianMS: fileBaselineWrite}
			if err := db.Raw("SELECT pg_relation_size('analysis_file_trgm'::regclass)").Scan(&fileIndex.IndexBytes).Error; err != nil {
				t.Fatal("could not measure file search index")
			}
			for _, query := range baseline {
				if query.Name == "public-file-search-rare" || query.Name == "public-file-search-common" {
					fileIndex.Queries = append(fileIndex.Queries, measureAnalysisQuery(t, db, query))
				}
			}
			fileIndex.WriteMedianMS = measureAnalysisWrite(t, db, fileWrite)
			report.Experiments = append(report.Experiments, fileIndex)
			analysisExec(t, db, "ROLLBACK TO SAVEPOINT file_search_index")
		}
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal("could not encode query analysis report")
	}
	if err := os.WriteFile(output, append(data, '\n'), 0o600); err != nil {
		t.Fatal("could not write QUERY_ANALYSIS_OUTPUT")
	}
	t.Logf("recorded %d baseline queries and %d experiments; isolated schema will be rolled back", len(report.Baseline), len(report.Experiments))
}

func baselineAnalysisQueries() []analysisQuery {
	queries := []analysisQuery{
		{"public-post-count", "SELECT count(*) FROM posts WHERE status='published'", nil},
		{"public-post-first", "SELECT p.* FROM posts p WHERE status='published' ORDER BY " + analysisTimeline + " LIMIT 10", nil},
		{"public-post-deep", "SELECT p.* FROM posts p WHERE status='published' ORDER BY " + analysisTimeline + " LIMIT 10 OFFSET 1500", nil},
		{"public-post-limit-100", "SELECT p.* FROM posts p WHERE status='published' ORDER BY " + analysisTimeline + " LIMIT 100", nil},
	}
	for _, category := range []int{1, 40, 0} {
		filter := "category_id = ?"
		args := []any{category}
		if category == 0 {
			filter, args = "category_id IS NULL", nil
		}
		queries = append(queries,
			analysisQuery{fmt.Sprintf("category-%d-count", category), "SELECT count(*) FROM posts WHERE status='published' AND " + filter, args},
			analysisQuery{fmt.Sprintf("category-%d-page", category), "SELECT p.* FROM posts p WHERE status='published' AND " + filter + " ORDER BY " + analysisTimeline + " LIMIT 10", args})
	}
	queries = append(queries,
		analysisQuery{"admin-post-count", "SELECT count(*) FROM posts", nil},
		analysisQuery{"admin-post-first", "SELECT p.* FROM posts p ORDER BY CASE WHEN status='draft' THEN 1 ELSE 2 END, updated_at DESC, id DESC LIMIT 10", nil},
		analysisQuery{"admin-post-deep", "SELECT p.* FROM posts p ORDER BY CASE WHEN status='draft' THEN 1 ELSE 2 END, updated_at DESC, id DESC LIMIT 10 OFFSET 1500", nil},
		analysisQuery{"public-file-count", "SELECT count(*) FROM files WHERE is_system IS NOT TRUE", nil},
		analysisQuery{"public-file-first", "SELECT * FROM files WHERE is_system IS NOT TRUE ORDER BY created_at DESC,id DESC LIMIT 10", nil},
		analysisQuery{"public-file-deep", "SELECT * FROM files WHERE is_system IS NOT TRUE ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET 1000", nil},
		analysisQuery{"admin-file-first", "SELECT * FROM files ORDER BY created_at DESC,id DESC LIMIT 10", nil},
		analysisQuery{"public-categories", "SELECT c.*,count(p.id) AS post_count FROM categories c LEFT JOIN posts p ON p.category_id=c.id AND p.status='published' GROUP BY c.id ORDER BY c.name,c.id", nil},
		analysisQuery{"admin-categories", "SELECT c.*,count(p.id) AS post_count FROM categories c LEFT JOIN posts p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name,c.id", nil},
	)
	for _, term := range []string{"article", "needlequartz", "nohitszzzz", "中", "数据库", "hiddenneedle"} {
		pattern := "%" + term + "%"
		predicate := "(p.title ILIKE ? OR p.summary ILIKE ? OR p.content ILIKE ? OR c.name ILIKE ?)"
		args := []any{pattern, pattern, pattern, pattern}
		queries = append(queries,
			analysisQuery{"public-post-search-" + term, "SELECT p.* FROM posts p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='published' AND " + predicate + " ORDER BY " + analysisTimeline, args},
			analysisQuery{"admin-post-search-" + term, "SELECT p.* FROM posts p LEFT JOIN categories c ON c.id=p.category_id WHERE " + predicate + " ORDER BY p.updated_at DESC,p.id DESC", args},
			analysisQuery{"public-search-candidate-count-" + term, "SELECT count(*) FROM posts p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='published' AND " + predicate, args})
	}
	queries = append(queries,
		analysisQuery{"public-file-search-rare", "SELECT f.* FROM files f WHERE is_system IS NOT TRUE AND " + analysisFileName + " ILIKE ? ORDER BY created_at DESC,id DESC", []any{"%needlequartz%"}},
		analysisQuery{"public-file-search-common", "SELECT f.* FROM files f WHERE is_system IS NOT TRUE AND " + analysisFileName + " ILIKE ? ORDER BY created_at DESC,id DESC", []any{"%resource%"}},
		analysisQuery{"admin-file-search-description", "SELECT f.* FROM files f WHERE (" + analysisFileName + " ILIKE ? OR description ILIKE ?) ORDER BY created_at DESC,id DESC", []any{"%descriptionneedle%", "%descriptionneedle%"}},
	)
	return queries
}

func normalizedPostMatch(admin bool) string {
	filter := "p.status='published' AND "
	if admin {
		filter = ""
	}
	return "WITH metadata_matches AS MATERIALIZED (SELECT p.id FROM posts p WHERE " + filter + "(p.title ILIKE ? OR p.summary ILIKE ?)), remaining_posts AS MATERIALIZED (SELECT p.id FROM posts p WHERE " + filter + "p.id NOT IN (SELECT id FROM metadata_matches)) SELECT p.id FROM posts p WHERE EXISTS (SELECT 1 FROM remaining_posts) AND p.analysis_search_text ILIKE ? AND p.id IN (SELECT id FROM remaining_posts) UNION SELECT id FROM metadata_matches UNION SELECT p.id FROM posts p JOIN categories c ON c.id=p.category_id WHERE " + filter + "c.name ILIKE ?"
}

func mixedAnalysisQuery(term string, limit, offset int) analysisQuery {
	sql := "WITH matches AS MATERIALIZED (" +
		"SELECT 'post' AS kind,p.id,COALESCE(p.last_edited_at,p.published_at) AS sort_time FROM posts p JOIN (" + normalizedPostMatch(false) + ") hit ON hit.id=p.id" +
		" UNION ALL SELECT 'file' AS kind,f.id,f.created_at AS sort_time FROM files f WHERE f.is_system IS NOT TRUE AND " + analysisFileName + " ILIKE ?" +
		"), totals AS (SELECT count(*) AS total,count(*) FILTER (WHERE kind='post') AS posts_total,count(*) FILTER (WHERE kind='file') AS files_total FROM matches), page AS (SELECT * FROM matches ORDER BY sort_time DESC,kind ASC,id DESC LIMIT ? OFFSET ?)" +
		" SELECT totals.*,COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY sort_time DESC,kind ASC,id DESC) FROM page),'[]'::jsonb) AS items FROM totals"
	pattern := "%" + term + "%"
	return analysisQuery{fmt.Sprintf("mixed-%s-offset-%d", term, offset), sql, []any{pattern, pattern, pattern, pattern, pattern, limit, offset}}
}

func prototypeAnalysisQueries() []analysisQuery {
	queries := []analysisQuery{{"summary-post-page", "SELECT " + analysisPostColumns + " FROM posts p WHERE status='published' ORDER BY " + analysisTimeline + " LIMIT 10", nil}}
	for _, term := range []string{"article", "needlequartz", "nohitszzzz", "中", "数据库", "hiddenneedle"} {
		pattern := "%" + term + "%"
		for _, admin := range []bool{false, true} {
			order := analysisTimeline
			audience := "public"
			if admin {
				order, audience = "p.updated_at DESC,p.id DESC", "admin"
			}
			matches := normalizedPostMatch(admin)
			queries = append(queries,
				analysisQuery{audience + "-normalized-page-" + term, "SELECT " + analysisPostColumns + " FROM posts p JOIN (" + matches + ") hit ON hit.id=p.id ORDER BY " + order + " LIMIT 10", []any{pattern, pattern, pattern, pattern}},
				analysisQuery{audience + "-normalized-count-" + term, "SELECT count(*) FROM (" + matches + ") hit", []any{pattern, pattern, pattern, pattern}})
		}
		queries = append(queries, mixedAnalysisQuery(term, 10, 0))
	}
	queries = append(queries, mixedAnalysisQuery("article", 10, 1500), mixedAnalysisQuery("needlequartz", 10, 10000))
	return queries
}

func measureAnalysisQuery(t testing.TB, db *gorm.DB, query analysisQuery) analysisMeasurement {
	t.Helper()
	result := analysisMeasurement{Name: query.Name, SQL: query.SQL, Args: query.Args}
	durations := []float64{}
	for range 3 {
		var raw []byte
		if err := db.Raw("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+query.SQL, query.Args...).Row().Scan(&raw); err != nil {
			t.Fatalf("EXPLAIN failed for %s", query.Name)
		}
		var plans []map[string]any
		if err := json.Unmarshal(raw, &plans); err != nil || len(plans) != 1 {
			t.Fatal("invalid EXPLAIN JSON")
		}
		duration, ok := plans[0]["Execution Time"].(float64)
		if !ok {
			t.Fatal("EXPLAIN did not execute the query")
		}
		durations = append(durations, duration)
		result.Samples = append(result.Samples, json.RawMessage(raw))
	}
	sort.Float64s(durations)
	result.MedianMS = durations[1]
	return result
}

func measureAnalysisWrite(t testing.TB, db *gorm.DB, sql string) float64 {
	t.Helper()
	durations := []float64{}
	for range 3 {
		analysisExec(t, db, "SAVEPOINT write_probe")
		started := time.Now()
		analysisExec(t, db, sql)
		durations = append(durations, elapsedMS(started))
		analysisExec(t, db, "ROLLBACK TO SAVEPOINT write_probe")
		analysisExec(t, db, "RELEASE SAVEPOINT write_probe")
	}
	sort.Float64s(durations)
	return durations[1]
}

func elapsedMS(started time.Time) float64 { return float64(time.Since(started).Microseconds()) / 1000 }

func verifyAnalysisSearchContract(t *testing.T, db *gorm.DB) {
	t.Helper()
	type item struct {
		Kind string
		ID   int
	}
	seen := map[string]bool{}
	var wantedTotal int64
	var expectedPosts, expectedFiles int64
	for i := 0; i < 2400; i++ {
		if i%113 == 0 && i%5 != 0 {
			expectedPosts++
		}
	}
	for i := 0; i < 1200; i++ {
		if i%113 == 0 && i%10 != 0 {
			expectedFiles++
		}
	}
	for _, offset := range []int{0, 10, 20, 30, 10000} {
		query := mixedAnalysisQuery("needlequartz", 10, offset)
		var previous string
		for attempt := range 2 {
			var row struct {
				Total      int64
				PostsTotal int64
				FilesTotal int64
				Items      string
			}
			if err := db.Raw(query.SQL, query.Args...).Scan(&row).Error; err != nil {
				t.Fatal("could not verify search contract")
			}
			if row.Total != row.PostsTotal+row.FilesTotal || row.PostsTotal == 0 || row.FilesTotal == 0 {
				t.Fatal("inconsistent mixed search totals")
			}
			if row.PostsTotal != expectedPosts || row.FilesTotal != expectedFiles {
				t.Fatal("totals do not match the independently counted fixture")
			}
			if offset == 0 {
				wantedTotal = row.Total
			} else if row.Total != wantedTotal {
				t.Fatal("totals changed across fixture pages")
			}
			var items []item
			if err := json.Unmarshal([]byte(row.Items), &items); err != nil || len(items) > 10 {
				t.Fatal("mixed search exceeded its combined limit")
			}
			if offset == 10000 && len(items) != 0 {
				t.Fatal("out-of-range page must be empty")
			}
			if attempt == 1 {
				if row.Items != previous {
					t.Fatal("ordering is unstable for tied timestamps")
				}
				continue
			}
			previous = row.Items
			for _, entry := range items {
				key := fmt.Sprintf("%s:%d", entry.Kind, entry.ID)
				if seen[key] {
					t.Fatal("duplicate result across pages")
				}
				seen[key] = true
				if (entry.Kind == "post" && (entry.ID-1)%5 == 0) || (entry.Kind == "file" && (entry.ID-1)%10 == 0) {
					t.Fatal("private fixture resource appeared in public search")
				}
			}
		}
	}
	if int64(len(seen)) != wantedTotal {
		t.Fatal("paging did not recover every matching resource")
	}
	var hidden int64
	if err := db.Raw("SELECT count(*) FROM posts WHERE analysis_search_text ILIKE '%hiddenneedle%'").Scan(&hidden).Error; err != nil || hidden != 0 {
		t.Fatal("hidden fixture text leaked into normalized search")
	}
}
