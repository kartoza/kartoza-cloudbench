package llm

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/kartoza/kartoza-cloudbench/internal/postgres"
)

// QueryExecutor executes SQL queries against PostgreSQL
type QueryExecutor struct {
	maxRows     int
	timeout     time.Duration
	readOnly    bool
	allowedOps  []string
}

// ExecutorOption configures the executor
type ExecutorOption func(*QueryExecutor)

// WithMaxRows sets the maximum rows to return
func WithMaxRows(n int) ExecutorOption {
	return func(e *QueryExecutor) {
		e.maxRows = n
	}
}

// WithTimeout sets the query timeout
func WithTimeout(d time.Duration) ExecutorOption {
	return func(e *QueryExecutor) {
		e.timeout = d
	}
}

// WithReadOnly restricts to read-only queries
func WithReadOnly(readOnly bool) ExecutorOption {
	return func(e *QueryExecutor) {
		e.readOnly = readOnly
	}
}

// WithAllowedOps sets allowed SQL operations
func WithAllowedOps(ops []string) ExecutorOption {
	return func(e *QueryExecutor) {
		e.allowedOps = ops
	}
}

// NewQueryExecutor creates a new query executor
func NewQueryExecutor(opts ...ExecutorOption) *QueryExecutor {
	e := &QueryExecutor{
		maxRows:    100,
		timeout:    30 * time.Second,
		readOnly:   true,
		allowedOps: []string{"SELECT"},
	}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

// Execute runs a SQL query and returns the results
func (e *QueryExecutor) Execute(ctx context.Context, serviceName, sqlQuery string) (*QueryResult, error) {
	// Validate the query
	if err := e.validateQuery(sqlQuery); err != nil {
		return nil, err
	}

	// Get database connection
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		return nil, fmt.Errorf("failed to parse pg_service.conf: %w", err)
	}

	svc, err := postgres.GetServiceByName(services, serviceName)
	if err != nil {
		return nil, fmt.Errorf("service not found: %w", err)
	}

	db, err := svc.Connect()
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer db.Close()

	// Apply timeout
	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()

	// Add LIMIT if not present
	sqlQuery = e.ensureLimit(sqlQuery)

	// Execute query
	startTime := time.Now()
	rows, err := db.QueryContext(ctx, sqlQuery)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	// Get column info
	columnTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("failed to get column types: %w", err)
	}

	columns := make([]ColumnInfo, len(columnTypes))
	for i, ct := range columnTypes {
		nullable, _ := ct.Nullable()
		columns[i] = ColumnInfo{
			Name:     ct.Name(),
			Type:     ct.DatabaseTypeName(),
			Nullable: nullable,
		}
	}

	// Scan rows
	var resultRows []map[string]any
	scanArgs := make([]any, len(columns))
	scanDest := make([]any, len(columns))
	for i := range scanArgs {
		scanDest[i] = &scanArgs[i]
	}

	rowCount := 0
	for rows.Next() {
		if rowCount >= e.maxRows {
			break
		}

		if err := rows.Scan(scanDest...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		row := make(map[string]any)
		for i, col := range columns {
			val := scanArgs[i]
			// Convert byte slices to strings for JSON serialization
			if b, ok := val.([]byte); ok {
				row[col.Name] = string(b)
			} else {
				row[col.Name] = val
			}
		}
		resultRows = append(resultRows, row)
		rowCount++
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	duration := time.Since(startTime).Seconds() * 1000 // milliseconds

	return &QueryResult{
		Columns:  columns,
		Rows:     resultRows,
		RowCount: rowCount,
		Duration: duration,
		SQL:      sqlQuery,
	}, nil
}

// validateQuery checks if the query is allowed
func (e *QueryExecutor) validateQuery(sqlQuery string) error {
	sqlUpper := strings.ToUpper(strings.TrimSpace(sqlQuery))

	// Check for allowed operations
	allowed := false
	for _, op := range e.allowedOps {
		if strings.HasPrefix(sqlUpper, op) {
			allowed = true
			break
		}
	}

	if !allowed {
		return fmt.Errorf("%w: operation not allowed", ErrUnsafeQuery)
	}

	// Check for dangerous patterns in read-only mode
	if e.readOnly {
		dangerous := []string{
			"DROP ", "DELETE ", "TRUNCATE ", "UPDATE ", "INSERT ",
			"ALTER ", "CREATE ", "GRANT ", "REVOKE ", "EXECUTE ",
		}
		for _, d := range dangerous {
			if strings.Contains(sqlUpper, d) {
				return fmt.Errorf("%w: %s not allowed in read-only mode", ErrUnsafeQuery, strings.TrimSpace(d))
			}
		}
	}

	// Check for SQL injection patterns
	injectionPatterns := []string{
		"--", ";--", ";", "/*", "*/", "@@", "@",
		"CHAR(", "NCHAR(", "VARCHAR(", "NVARCHAR(",
		"EXEC(", "EXECUTE(", "XP_", "SP_",
	}
	for _, pattern := range injectionPatterns {
		// Only flag if it looks suspicious (not in string literals)
		if strings.Contains(sqlUpper, pattern) && !strings.Contains(sqlQuery, "'") {
			// Allow semicolon only at end
			if pattern == ";" && strings.HasSuffix(strings.TrimSpace(sqlQuery), ";") {
				continue
			}
			// Allow comments in some cases
			if pattern == "--" || pattern == "/*" || pattern == "*/" {
				continue
			}
		}
	}

	return nil
}

// ensureLimit adds a LIMIT clause if not present
func (e *QueryExecutor) ensureLimit(sqlQuery string) string {
	sqlUpper := strings.ToUpper(sqlQuery)
	if !strings.Contains(sqlUpper, "LIMIT") {
		// Remove trailing semicolon if present
		sqlQuery = strings.TrimSuffix(strings.TrimSpace(sqlQuery), ";")
		sqlQuery = fmt.Sprintf("%s LIMIT %d", sqlQuery, e.maxRows)
	}
	return sqlQuery
}

// GetExecutionPlan returns the query execution plan
func (e *QueryExecutor) GetExecutionPlan(ctx context.Context, serviceName, sqlQuery string) (*ExecutionPlan, error) {
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		return nil, err
	}

	svc, err := postgres.GetServiceByName(services, serviceName)
	if err != nil {
		return nil, err
	}

	db, err := svc.Connect()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	// Get EXPLAIN output
	explainSQL := fmt.Sprintf("EXPLAIN (FORMAT JSON) %s", sqlQuery)
	var planJSON string
	err = db.QueryRowContext(ctx, explainSQL).Scan(&planJSON)
	if err != nil {
		return nil, err
	}

	// Parse the plan (simplified)
	plan := &ExecutionPlan{}

	if strings.Contains(planJSON, "Index Scan") || strings.Contains(planJSON, "Index Only Scan") {
		plan.UsesIndex = true
		plan.ScanType = "Index Scan"
	} else if strings.Contains(planJSON, "Seq Scan") {
		plan.UsesIndex = false
		plan.ScanType = "Sequential Scan"
	}

	return plan, nil
}

// BuildSchemaContext builds schema context from a PostgreSQL service
func BuildSchemaContext(serviceName string) (*SchemaContext, error) {
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		return nil, err
	}

	svc, err := postgres.GetServiceByName(services, serviceName)
	if err != nil {
		return nil, err
	}

	db, err := svc.Connect()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	ctx := &SchemaContext{
		ServiceName: serviceName,
		Database:    svc.DBName,
		Schemas:     []SchemaInfo{},
	}

	// Get schemas
	schemaRows, err := db.Query(`
		SELECT schema_name
		FROM information_schema.schemata
		WHERE schema_name NOT LIKE 'pg_%'
		  AND schema_name != 'information_schema'
		ORDER BY schema_name
	`)
	if err != nil {
		return nil, err
	}
	defer schemaRows.Close()

	var schemaNames []string
	for schemaRows.Next() {
		var name string
		if err := schemaRows.Scan(&name); err != nil {
			return nil, err
		}
		schemaNames = append(schemaNames, name)
	}

	// Get tables for each schema
	for _, schemaName := range schemaNames {
		schema := SchemaInfo{
			Name:   schemaName,
			Tables: []TableInfo{},
			Views:  []ViewInfo{},
		}

		// Get tables
		tableRows, err := db.Query(`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = $1 AND table_type = 'BASE TABLE'
			ORDER BY table_name
		`, schemaName)
		if err != nil {
			continue
		}

		var tableNames []string
		for tableRows.Next() {
			var name string
			if err := tableRows.Scan(&name); err != nil {
				continue
			}
			tableNames = append(tableNames, name)
		}
		tableRows.Close()

		// Get columns for each table
		for _, tableName := range tableNames {
			table := TableInfo{
				Name:    tableName,
				Columns: []ColumnDef{},
			}

			// Get columns
			colRows, err := db.Query(`
				SELECT column_name, data_type, is_nullable, column_default
				FROM information_schema.columns
				WHERE table_schema = $1 AND table_name = $2
				ORDER BY ordinal_position
			`, schemaName, tableName)
			if err != nil {
				continue
			}

			for colRows.Next() {
				var name, dataType, isNullable string
				var defaultVal sql.NullString
				if err := colRows.Scan(&name, &dataType, &isNullable, &defaultVal); err != nil {
					continue
				}
				col := ColumnDef{
					Name:     name,
					Type:     dataType,
					Nullable: isNullable == "YES",
				}
				if defaultVal.Valid {
					col.DefaultValue = defaultVal.String
				}
				table.Columns = append(table.Columns, col)
			}
			colRows.Close()

			// Check for geometry column (PostGIS)
			var geomCol, geomType string
			var srid int
			err = db.QueryRow(`
				SELECT f_geometry_column, type, srid
				FROM geometry_columns
				WHERE f_table_schema = $1 AND f_table_name = $2
				LIMIT 1
			`, schemaName, tableName).Scan(&geomCol, &geomType, &srid)
			if err == nil {
				table.HasGeometry = true
				table.GeometryColumn = geomCol
				table.GeometryType = geomType
				table.SRID = srid
			}

			// Get row count estimate
			var rowCount int64
			db.QueryRow(`
				SELECT reltuples::bigint
				FROM pg_class c
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = $1 AND c.relname = $2
			`, schemaName, tableName).Scan(&rowCount)
			table.RowCount = rowCount

			schema.Tables = append(schema.Tables, table)
		}

		ctx.Schemas = append(ctx.Schemas, schema)
	}

	return ctx, nil
}
