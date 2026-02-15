package ogr2ogr

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/kartoza/kartoza-cloudbench/internal/postgres"
)

// ImportOptions configures a data import operation
type ImportOptions struct {
	SourceFile     string   // Path to source file (Shapefile, GeoJSON, GeoPackage, etc.)
	TargetService  string   // PostgreSQL service name from pg_service.conf
	TargetSchema   string   // Target schema (default: "public")
	TableName      string   // Target table name (auto-detected from layer if empty)
	SRID           int      // Source SRID (0 = auto-detect)
	TargetSRID     int      // Target SRID (0 = keep source)
	Overwrite      bool     // Overwrite existing table
	Append         bool     // Append to existing table
	CreateSchema   bool     // Create schema if it doesn't exist
	SourceLayer    string   // Specific layer to import (for multi-layer formats)
	GeometryColumn string   // Name for geometry column (default: "geom")
	SkipFailures   bool     // Skip features that fail to import
	Encoding       string   // Source file encoding (default: auto-detect)
}

// ImportResult contains the result of an import operation
type ImportResult struct {
	Success       bool
	TableName     string
	FeaturesTotal int
	FeaturesAdded int
	Errors        []string
	Warnings      []string
	Duration      float64 // seconds
}

// LayerInfo contains information about a layer in a data source
type LayerInfo struct {
	Name         string      `json:"name"`
	GeometryType string      `json:"geometry_type"`
	FeatureCount int         `json:"feature_count"`
	SRID         int         `json:"srid"`
	Fields       []FieldInfo `json:"fields"`
	Extent       *Extent     `json:"extent,omitempty"`
}

// FieldInfo contains information about a field in a layer
type FieldInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Width    int    `json:"width"`
	Nullable bool   `json:"nullable"`
}

// Extent represents a spatial extent
type Extent struct {
	MinX float64 `json:"min_x"`
	MinY float64 `json:"min_y"`
	MaxX float64 `json:"max_x"`
	MaxY float64 `json:"max_y"`
}

// ProgressCallback is called with progress updates during import
type ProgressCallback func(percent int, message string)

// CheckAvailable checks if ogr2ogr is available on the system
func CheckAvailable() bool {
	_, err := exec.LookPath("ogr2ogr")
	return err == nil
}

// GetVersion returns the ogr2ogr version string
func GetVersion() (string, error) {
	cmd := exec.Command("ogr2ogr", "--version")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// DetectLayers detects available layers in a data source
func DetectLayers(sourcePath string) ([]LayerInfo, error) {
	if !CheckAvailable() {
		return nil, fmt.Errorf("ogr2ogr not found in PATH")
	}

	// Use ogrinfo to get layer information
	cmd := exec.Command("ogrinfo", "-al", "-so", sourcePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to read source: %w", err)
	}

	return parseOgrInfo(string(output))
}

// parseOgrInfo parses ogrinfo output to extract layer information
func parseOgrInfo(output string) ([]LayerInfo, error) {
	var layers []LayerInfo
	var currentLayer *LayerInfo

	lines := strings.Split(output, "\n")
	layerRegex := regexp.MustCompile(`^Layer name: (.+)$`)
	geomRegex := regexp.MustCompile(`^Geometry: (.+)$`)
	countRegex := regexp.MustCompile(`^Feature Count: (\d+)$`)
	sridRegex := regexp.MustCompile(`EPSG:(\d+)`)
	fieldRegex := regexp.MustCompile(`^(\w+): (\w+)`)
	extentRegex := regexp.MustCompile(`^Extent: \(([^,]+), ([^)]+)\) - \(([^,]+), ([^)]+)\)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if matches := layerRegex.FindStringSubmatch(line); matches != nil {
			if currentLayer != nil {
				layers = append(layers, *currentLayer)
			}
			currentLayer = &LayerInfo{
				Name:   matches[1],
				Fields: []FieldInfo{},
			}
			continue
		}

		if currentLayer == nil {
			continue
		}

		if matches := geomRegex.FindStringSubmatch(line); matches != nil {
			currentLayer.GeometryType = matches[1]
		} else if matches := countRegex.FindStringSubmatch(line); matches != nil {
			currentLayer.FeatureCount, _ = strconv.Atoi(matches[1])
		} else if matches := sridRegex.FindStringSubmatch(line); matches != nil && currentLayer.SRID == 0 {
			currentLayer.SRID, _ = strconv.Atoi(matches[1])
		} else if matches := extentRegex.FindStringSubmatch(line); matches != nil {
			minX, _ := strconv.ParseFloat(matches[1], 64)
			minY, _ := strconv.ParseFloat(matches[2], 64)
			maxX, _ := strconv.ParseFloat(matches[3], 64)
			maxY, _ := strconv.ParseFloat(matches[4], 64)
			currentLayer.Extent = &Extent{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY}
		} else if matches := fieldRegex.FindStringSubmatch(line); matches != nil {
			// Skip known non-field lines
			if matches[1] != "Layer" && matches[1] != "Geometry" && matches[1] != "Feature" {
				currentLayer.Fields = append(currentLayer.Fields, FieldInfo{
					Name: matches[1],
					Type: matches[2],
				})
			}
		}
	}

	if currentLayer != nil {
		layers = append(layers, *currentLayer)
	}

	return layers, nil
}

// Import imports data from a file to PostgreSQL using ogr2ogr
func Import(ctx context.Context, opts ImportOptions, progress ProgressCallback) (*ImportResult, error) {
	if !CheckAvailable() {
		return nil, fmt.Errorf("ogr2ogr not found in PATH")
	}

	// Get the PostgreSQL connection string
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		return nil, fmt.Errorf("failed to parse pg_service.conf: %w", err)
	}

	svc, err := postgres.GetServiceByName(services, opts.TargetService)
	if err != nil {
		return nil, fmt.Errorf("service not found: %w", err)
	}

	result := &ImportResult{
		Errors:   []string{},
		Warnings: []string{},
	}

	// Build connection string for ogr2ogr
	pgConnStr := buildPGConnectionString(svc, opts.TargetSchema)

	// Determine table name
	tableName := opts.TableName
	if tableName == "" {
		// Use source filename as table name
		baseName := filepath.Base(opts.SourceFile)
		tableName = strings.TrimSuffix(baseName, filepath.Ext(baseName))
		tableName = sanitizeTableName(tableName)
	}
	result.TableName = tableName

	// Build ogr2ogr command
	args := buildOgr2OgrArgs(opts, pgConnStr, tableName)

	if progress != nil {
		progress(0, "Starting import of "+filepath.Base(opts.SourceFile))
	}

	// Execute ogr2ogr
	cmd := exec.CommandContext(ctx, "ogr2ogr", args...)

	// Capture stderr for progress and errors
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start ogr2ogr: %w", err)
	}

	// Read output in background
	var wg sync.WaitGroup
	var outputLines []string
	var mu sync.Mutex

	wg.Add(2)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			outputLines = append(outputLines, line)
			mu.Unlock()

			// Parse progress from ogr2ogr output
			if progress != nil && strings.Contains(line, "Progress:") {
				if pct := parseProgress(line); pct > 0 {
					progress(pct, "Importing features...")
				}
			}
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			mu.Lock()
			outputLines = append(outputLines, line)
			mu.Unlock()
		}
	}()

	// Wait for command to complete
	err = cmd.Wait()
	wg.Wait()

	// Parse output for errors/warnings
	for _, line := range outputLines {
		if strings.Contains(line, "ERROR") || strings.Contains(line, "Error") {
			result.Errors = append(result.Errors, line)
		} else if strings.Contains(line, "WARNING") || strings.Contains(line, "Warning") {
			result.Warnings = append(result.Warnings, line)
		}
	}

	if err != nil {
		result.Success = false
		if len(result.Errors) == 0 {
			result.Errors = append(result.Errors, err.Error())
		}
		return result, nil
	}

	result.Success = true
	if progress != nil {
		progress(100, "Import complete: "+tableName)
	}

	return result, nil
}

// buildPGConnectionString builds the PostgreSQL connection string for ogr2ogr
func buildPGConnectionString(svc *postgres.ServiceEntry, schema string) string {
	parts := []string{"PG:"}

	if svc.Host != "" {
		parts = append(parts, fmt.Sprintf("host=%s", svc.Host))
	}
	if svc.Port != "" {
		parts = append(parts, fmt.Sprintf("port=%s", svc.Port))
	}
	if svc.DBName != "" {
		parts = append(parts, fmt.Sprintf("dbname=%s", svc.DBName))
	}
	if svc.User != "" {
		parts = append(parts, fmt.Sprintf("user=%s", svc.User))
	}
	if svc.Password != "" {
		parts = append(parts, fmt.Sprintf("password=%s", svc.Password))
	}
	if schema != "" && schema != "public" {
		parts = append(parts, fmt.Sprintf("active_schema=%s", schema))
	}

	return strings.Join(parts, " ")
}

// buildOgr2OgrArgs builds the ogr2ogr command arguments
func buildOgr2OgrArgs(opts ImportOptions, pgConnStr, tableName string) []string {
	args := []string{
		"-f", "PostgreSQL",
		pgConnStr,
		opts.SourceFile,
		"-nln", tableName,
	}

	// Geometry column name
	if opts.GeometryColumn != "" {
		args = append(args, "-lco", fmt.Sprintf("GEOMETRY_NAME=%s", opts.GeometryColumn))
	} else {
		args = append(args, "-lco", "GEOMETRY_NAME=geom")
	}

	// Handle overwrite/append
	if opts.Overwrite {
		args = append(args, "-overwrite")
	} else if opts.Append {
		args = append(args, "-append")
	}

	// Source SRID
	if opts.SRID > 0 {
		args = append(args, "-a_srs", fmt.Sprintf("EPSG:%d", opts.SRID))
	}

	// Target SRID (reproject)
	if opts.TargetSRID > 0 && opts.TargetSRID != opts.SRID {
		args = append(args, "-t_srs", fmt.Sprintf("EPSG:%d", opts.TargetSRID))
	}

	// Source layer selection
	if opts.SourceLayer != "" {
		args = append(args, opts.SourceLayer)
	}

	// Skip failures
	if opts.SkipFailures {
		args = append(args, "-skipfailures")
	}

	// Encoding
	if opts.Encoding != "" {
		args = append(args, "-oo", fmt.Sprintf("ENCODING=%s", opts.Encoding))
	}

	// Progress reporting
	args = append(args, "-progress")

	return args
}

// sanitizeTableName sanitizes a string to be a valid PostgreSQL table name
func sanitizeTableName(name string) string {
	// Convert to lowercase
	name = strings.ToLower(name)

	// Replace spaces and special characters with underscores
	reg := regexp.MustCompile(`[^a-z0-9_]`)
	name = reg.ReplaceAllString(name, "_")

	// Remove leading digits
	for len(name) > 0 && name[0] >= '0' && name[0] <= '9' {
		name = name[1:]
	}

	// Ensure name starts with letter or underscore
	if len(name) == 0 {
		name = "imported_data"
	}

	// Limit length to 63 characters (PostgreSQL identifier limit)
	if len(name) > 63 {
		name = name[:63]
	}

	return name
}

// parseProgress extracts progress percentage from ogr2ogr output
func parseProgress(line string) int {
	// ogr2ogr progress output format: "Progress: X.XX%"
	reg := regexp.MustCompile(`Progress:\s*([\d.]+)%`)
	if matches := reg.FindStringSubmatch(line); matches != nil {
		if pct, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return int(pct)
		}
	}
	return 0
}

// SupportedFormats returns a list of input formats supported by ogr2ogr
func SupportedFormats() []string {
	return []string{
		"ESRI Shapefile",
		"GeoJSON",
		"GeoPackage",
		"KML",
		"KMZ",
		"GML",
		"CSV",
		"MapInfo File",
		"DXF",
		"GPX",
		"SQLite",
		"PostgreSQL",
		"MySQL",
		"FileGDB",
		"OpenFileGDB",
	}
}

// GetSupportedExtensions returns file extensions supported for import
func GetSupportedExtensions() map[string]string {
	return map[string]string{
		".shp":     "ESRI Shapefile",
		".geojson": "GeoJSON",
		".json":    "GeoJSON",
		".gpkg":    "GeoPackage",
		".kml":     "KML",
		".kmz":     "KMZ",
		".gml":     "GML",
		".csv":     "CSV",
		".tab":     "MapInfo File",
		".mif":     "MapInfo File",
		".dxf":     "DXF",
		".gpx":     "GPX",
		".sqlite":  "SQLite",
		".db":      "SQLite",
		".gdb":     "FileGDB",
	}
}

// IsSupported checks if a file extension is supported for import
func IsSupported(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	_, ok := GetSupportedExtensions()[ext]
	if ok {
		return true
	}
	// Also check raster formats
	_, ok = GetRasterExtensions()[ext]
	return ok
}

// GetAllSupportedExtensions returns all supported extensions (vector + raster)
func GetAllSupportedExtensions() map[string]string {
	result := make(map[string]string)
	for k, v := range GetSupportedExtensions() {
		result[k] = v
	}
	for k, v := range GetRasterExtensions() {
		result[k] = v
	}
	return result
}
