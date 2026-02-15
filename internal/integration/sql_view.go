package integration

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/kartoza/kartoza-cloudbench/internal/api"
	"github.com/kartoza/kartoza-cloudbench/internal/llm"
	"github.com/kartoza/kartoza-cloudbench/internal/query"
)

// SQLViewLayerConfig contains all configuration for creating a SQL View layer
type SQLViewLayerConfig struct {
	// GeoServer connection details
	GeoServerConnectionID string `json:"geoserver_connection_id"`
	Workspace             string `json:"workspace"`
	DataStore             string `json:"datastore"` // PostGIS data store to use

	// Layer details
	LayerName      string `json:"layer_name"`
	Title          string `json:"title"`
	Abstract       string `json:"abstract"`

	// SQL Query source (one of these should be provided)
	SQL            string                  `json:"sql,omitempty"`            // Direct SQL
	QueryDefinition *query.QueryDefinition `json:"query_definition,omitempty"` // Visual query

	// Geometry configuration
	GeometryColumn string `json:"geometry_column"`
	GeometryType   string `json:"geometry_type"` // Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon
	SRID           int    `json:"srid"`

	// Optional
	KeyColumn  string               `json:"key_column,omitempty"`
	Parameters []api.SQLViewParameter `json:"parameters,omitempty"`
}

// SQLViewLayerResult contains the result of creating a SQL View layer
type SQLViewLayerResult struct {
	Success     bool   `json:"success"`
	LayerName   string `json:"layer_name"`
	Workspace   string `json:"workspace"`
	DataStore   string `json:"datastore"`
	SQL         string `json:"sql"`
	WMSEndpoint string `json:"wms_endpoint,omitempty"`
	WFSEndpoint string `json:"wfs_endpoint,omitempty"`
	Error       string `json:"error,omitempty"`
}

// CreateSQLViewLayer creates a GeoServer SQL View layer from configuration
func CreateSQLViewLayer(
	gsClient *api.Client,
	config SQLViewLayerConfig,
) (*SQLViewLayerResult, error) {
	result := &SQLViewLayerResult{
		LayerName: config.LayerName,
		Workspace: config.Workspace,
		DataStore: config.DataStore,
	}

	// Get the SQL query
	sql := config.SQL
	if sql == "" && config.QueryDefinition != nil {
		// Build SQL from query definition
		qb := query.FromDefinition(*config.QueryDefinition)
		builtSQL, _, err := qb.Build()
		if err != nil {
			result.Error = fmt.Sprintf("failed to build SQL from query definition: %v", err)
			return result, fmt.Errorf(result.Error)
		}
		sql = builtSQL
	}

	if sql == "" {
		result.Error = "no SQL query provided"
		return result, fmt.Errorf(result.Error)
	}

	result.SQL = sql

	// Validate and sanitize the SQL
	if err := validateSQLForView(sql); err != nil {
		result.Error = fmt.Sprintf("SQL validation failed: %v", err)
		return result, fmt.Errorf(result.Error)
	}

	// Set defaults
	geomType := config.GeometryType
	if geomType == "" {
		geomType = "Geometry"
	}

	srid := config.SRID
	if srid == 0 {
		srid = 4326
	}

	// Create the SQL View layer configuration
	viewConfig := api.SQLViewConfig{
		Name:           config.LayerName,
		Title:          config.Title,
		Abstract:       config.Abstract,
		SQL:            sql,
		KeyColumn:      config.KeyColumn,
		GeometryColumn: config.GeometryColumn,
		GeometryType:   geomType,
		GeometrySRID:   srid,
		Parameters:     config.Parameters,
		EscapeSql:      false, // Don't escape, we've validated it
	}

	// Create the layer
	if err := gsClient.CreateSQLViewLayer(config.Workspace, config.DataStore, viewConfig); err != nil {
		result.Error = fmt.Sprintf("failed to create SQL view layer: %v", err)
		return result, fmt.Errorf(result.Error)
	}

	result.Success = true

	// Build endpoint URLs
	baseURL := gsClient.BaseURL()
	result.WMSEndpoint = fmt.Sprintf("%s/wms?service=WMS&request=GetCapabilities", baseURL)
	result.WFSEndpoint = fmt.Sprintf("%s/wfs?service=WFS&request=GetCapabilities", baseURL)

	return result, nil
}

// UpdateSQLViewLayer updates an existing SQL View layer
func UpdateSQLViewLayer(
	gsClient *api.Client,
	config SQLViewLayerConfig,
) (*SQLViewLayerResult, error) {
	result := &SQLViewLayerResult{
		LayerName: config.LayerName,
		Workspace: config.Workspace,
		DataStore: config.DataStore,
	}

	sql := config.SQL
	if sql == "" && config.QueryDefinition != nil {
		qb := query.FromDefinition(*config.QueryDefinition)
		builtSQL, _, err := qb.Build()
		if err != nil {
			result.Error = fmt.Sprintf("failed to build SQL from query definition: %v", err)
			return result, fmt.Errorf(result.Error)
		}
		sql = builtSQL
	}

	if sql == "" {
		result.Error = "no SQL query provided"
		return result, fmt.Errorf(result.Error)
	}

	result.SQL = sql

	if err := validateSQLForView(sql); err != nil {
		result.Error = fmt.Sprintf("SQL validation failed: %v", err)
		return result, fmt.Errorf(result.Error)
	}

	geomType := config.GeometryType
	if geomType == "" {
		geomType = "Geometry"
	}

	srid := config.SRID
	if srid == 0 {
		srid = 4326
	}

	viewConfig := api.SQLViewConfig{
		Name:           config.LayerName,
		Title:          config.Title,
		Abstract:       config.Abstract,
		SQL:            sql,
		KeyColumn:      config.KeyColumn,
		GeometryColumn: config.GeometryColumn,
		GeometryType:   geomType,
		GeometrySRID:   srid,
		Parameters:     config.Parameters,
		EscapeSql:      false,
	}

	if err := gsClient.UpdateSQLViewLayer(config.Workspace, config.DataStore, viewConfig); err != nil {
		result.Error = fmt.Sprintf("failed to update SQL view layer: %v", err)
		return result, fmt.Errorf(result.Error)
	}

	result.Success = true
	baseURL := gsClient.BaseURL()
	result.WMSEndpoint = fmt.Sprintf("%s/wms?service=WMS&request=GetCapabilities", baseURL)
	result.WFSEndpoint = fmt.Sprintf("%s/wfs?service=WFS&request=GetCapabilities", baseURL)

	return result, nil
}

// DeleteSQLViewLayer deletes a SQL View layer
func DeleteSQLViewLayer(
	gsClient *api.Client,
	workspace, dataStore, layerName string,
) error {
	return gsClient.DeleteSQLViewLayer(workspace, dataStore, layerName)
}

// validateSQLForView validates SQL for use in a GeoServer SQL View
func validateSQLForView(sql string) error {
	upperSQL := strings.ToUpper(strings.TrimSpace(sql))

	// Must be a SELECT query
	if !strings.HasPrefix(upperSQL, "SELECT") {
		return fmt.Errorf("SQL must be a SELECT query")
	}

	// Disallow dangerous operations
	dangerousPatterns := []string{
		`\bDROP\b`,
		`\bDELETE\b`,
		`\bTRUNCATE\b`,
		`\bUPDATE\b`,
		`\bINSERT\b`,
		`\bCREATE\b`,
		`\bALTER\b`,
		`\bGRANT\b`,
		`\bREVOKE\b`,
		`\bEXECUTE\b`,
		`\bCALL\b`,
	}

	for _, pattern := range dangerousPatterns {
		matched, _ := regexp.MatchString(pattern, upperSQL)
		if matched {
			return fmt.Errorf("SQL contains disallowed operation: %s", pattern)
		}
	}

	// Check for common SQL injection patterns
	injectionPatterns := []string{
		`;\s*DROP`,
		`;\s*DELETE`,
		`--`,
		`/\*`,
		`\*/`,
		`xp_`,
		`sp_`,
	}

	for _, pattern := range injectionPatterns {
		matched, _ := regexp.MatchString(`(?i)`+pattern, sql)
		if matched {
			return fmt.Errorf("SQL contains suspicious pattern that may indicate injection: %s", pattern)
		}
	}

	return nil
}

// DetectGeometryColumn attempts to detect the geometry column and type from a SQL query
// by executing a sample query against the PostgreSQL database
func DetectGeometryColumn(pgServiceName string, sql string) (column string, geomType string, srid int, err error) {
	// Execute a limited query to get column info
	executor := llm.NewQueryExecutor(
		llm.WithMaxRows(1),
		llm.WithTimeout(10*time.Second),
		llm.WithReadOnly(true),
	)

	// Wrap the query to get geometry info
	detectSQL := fmt.Sprintf(`
		SELECT
			f.attname as column_name,
			postgis_typmod_srid(f.atttypmod) as srid,
			postgis_typmod_type(f.atttypmod) as geom_type
		FROM pg_attribute f
		JOIN pg_class c ON c.oid = f.attrelid
		JOIN pg_type t ON t.oid = f.atttypid
		WHERE c.relkind = 'v'
		  AND t.typname = 'geometry'
		  AND f.attnum > 0
		LIMIT 1
	`)

	// Try to get geometry info from the query itself
	// This is a heuristic - look for common geometry column names
	geomColumnPatterns := []string{
		"geom", "geometry", "the_geom", "wkb_geometry", "shape",
		"st_geom", "st_geometry", "location", "point", "line", "polygon",
	}

	lowerSQL := strings.ToLower(sql)
	for _, pattern := range geomColumnPatterns {
		if strings.Contains(lowerSQL, pattern) {
			column = pattern
			break
		}
	}

	// Default values
	if column == "" {
		column = "geom"
	}
	geomType = "Geometry"
	srid = 4326

	// Try to execute the detection query
	ctx := context.Background()
	result, execErr := executor.Execute(ctx, pgServiceName, detectSQL)
	if execErr == nil && len(result.Rows) > 0 {
		row := result.Rows[0]
		if col, ok := row["column_name"].(string); ok && col != "" {
			column = col
		}
		if s, ok := row["srid"].(float64); ok && s > 0 {
			srid = int(s)
		}
		if gt, ok := row["geom_type"].(string); ok && gt != "" {
			geomType = gt
		}
	}

	return column, geomType, srid, nil
}

// ListPostGISDataStores returns PostGIS data stores available in a workspace
func ListPostGISDataStores(gsClient *api.Client, workspace string) ([]string, error) {
	stores, err := gsClient.GetDataStores(workspace)
	if err != nil {
		return nil, err
	}

	var postGISStores []string
	for _, store := range stores {
		// Check if it's a PostGIS store by looking at the type
		// GeoServer returns different type identifiers
		if strings.Contains(strings.ToLower(store.Type), "postgis") ||
			strings.Contains(strings.ToLower(store.Type), "postgresql") {
			postGISStores = append(postGISStores, store.Name)
		}
	}

	return postGISStores, nil
}
