package cloudnative

import (
	"path/filepath"
	"strings"
	"time"
)

// ConversionType represents the type of cloud-native format conversion
type ConversionType string

const (
	// ConversionCOG converts raster data to Cloud Optimized GeoTIFF
	ConversionCOG ConversionType = "cog"
	// ConversionCOPC converts point cloud data to Cloud Optimized Point Cloud
	ConversionCOPC ConversionType = "copc"
	// ConversionGeoParquet converts vector data to GeoParquet
	ConversionGeoParquet ConversionType = "geoparquet"
	// ConversionNone indicates no conversion needed (already cloud-native)
	ConversionNone ConversionType = "none"
)

// String returns the display name for the conversion type
func (c ConversionType) String() string {
	switch c {
	case ConversionCOG:
		return "Cloud Optimized GeoTIFF"
	case ConversionCOPC:
		return "Cloud Optimized Point Cloud"
	case ConversionGeoParquet:
		return "GeoParquet"
	case ConversionNone:
		return "No Conversion"
	default:
		return "Unknown"
	}
}

// OutputExtension returns the typical file extension for the output format
func (c ConversionType) OutputExtension() string {
	switch c {
	case ConversionCOG:
		return ".cog.tif"
	case ConversionCOPC:
		return ".copc.laz"
	case ConversionGeoParquet:
		return ".parquet"
	default:
		return ""
	}
}

// ConversionJob represents a file format conversion job
type ConversionJob struct {
	ID           string         `json:"id"`
	SourcePath   string         `json:"source_path"`
	OutputPath   string         `json:"output_path"`
	SourceFormat string         `json:"source_format"`
	TargetFormat ConversionType `json:"target_format"`
	Status       JobStatus      `json:"status"`
	Progress     int            `json:"progress"` // 0-100
	Message      string         `json:"message"`
	Error        string         `json:"error,omitempty"`
	StartedAt    time.Time      `json:"started_at"`
	CompletedAt  time.Time      `json:"completed_at,omitempty"`
	InputSize    int64          `json:"input_size"`
	OutputSize   int64          `json:"output_size,omitempty"`
}

// JobStatus represents the status of a conversion job
type JobStatus string

const (
	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCancelled JobStatus = "cancelled"
)

// ProgressCallback is called during conversion with progress updates
type ProgressCallback func(progress int, message string)

// ConversionOptions contains options for format conversion
type ConversionOptions struct {
	// COG options
	COGBlockSize   int    `json:"cog_block_size,omitempty"`   // Default: 512
	COGCompression string `json:"cog_compression,omitempty"` // Default: "LZW"
	COGOverviews   bool   `json:"cog_overviews,omitempty"`   // Default: true

	// COPC options
	COPCThreads int `json:"copc_threads,omitempty"` // Default: 4

	// GeoParquet options
	ParquetCompression string `json:"parquet_compression,omitempty"` // Default: "ZSTD"
	ParquetRowGroup    int    `json:"parquet_row_group,omitempty"`   // Default: 65536
}

// DefaultConversionOptions returns default conversion options
func DefaultConversionOptions() ConversionOptions {
	return ConversionOptions{
		COGBlockSize:       512,
		COGCompression:     "LZW",
		COGOverviews:       true,
		COPCThreads:        4,
		ParquetCompression: "ZSTD",
		ParquetRowGroup:    65536,
	}
}

// DetectRecommendedConversion detects the recommended cloud-native format for a file
func DetectRecommendedConversion(filename string) (ConversionType, bool) {
	ext := strings.ToLower(filepath.Ext(filename))

	// Check if already cloud-native
	if IsCloudNative(filename) {
		return ConversionNone, false
	}

	// Raster formats -> COG
	switch ext {
	case ".tif", ".tiff", ".img", ".jp2", ".ecw", ".sid", ".asc", ".dem", ".hgt", ".nc":
		return ConversionCOG, true
	}

	// Point cloud formats -> COPC
	switch ext {
	case ".las", ".laz", ".e57", ".ply":
		return ConversionCOPC, true
	}

	// Vector formats -> GeoParquet
	switch ext {
	case ".shp", ".geojson", ".json", ".gpkg", ".gdb", ".kml", ".kmz", ".gml", ".csv", ".tab", ".mif", ".dxf", ".gpx":
		return ConversionGeoParquet, true
	}

	// ZIP files might contain shapefiles
	if ext == ".zip" {
		return ConversionGeoParquet, true
	}

	return ConversionNone, false
}

// IsCloudNative checks if a file is already in a cloud-native format
func IsCloudNative(filename string) bool {
	lower := strings.ToLower(filename)

	// Check for COG
	if strings.HasSuffix(lower, ".cog.tif") || strings.HasSuffix(lower, ".cog.tiff") {
		return true
	}

	// Check for COPC
	if strings.HasSuffix(lower, ".copc.laz") {
		return true
	}

	// Check for GeoParquet/Parquet
	if strings.HasSuffix(lower, ".parquet") || strings.HasSuffix(lower, ".geoparquet") {
		return true
	}

	return false
}

// GetSourceFormat returns a human-readable description of the source format
func GetSourceFormat(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))

	formatMap := map[string]string{
		".tif":     "GeoTIFF",
		".tiff":    "GeoTIFF",
		".img":     "ERDAS Imagine",
		".jp2":     "JPEG2000",
		".ecw":     "ECW",
		".sid":     "MrSID",
		".asc":     "ASCII Grid",
		".dem":     "USGS DEM",
		".hgt":     "SRTM HGT",
		".nc":      "NetCDF",
		".las":     "LAS Point Cloud",
		".laz":     "LAZ Point Cloud",
		".e57":     "E57 Point Cloud",
		".ply":     "PLY Point Cloud",
		".shp":     "Shapefile",
		".geojson": "GeoJSON",
		".json":    "JSON",
		".gpkg":    "GeoPackage",
		".gdb":     "File Geodatabase",
		".kml":     "KML",
		".kmz":     "KMZ",
		".gml":     "GML",
		".csv":     "CSV",
		".tab":     "MapInfo TAB",
		".mif":     "MapInfo MIF",
		".dxf":     "DXF",
		".gpx":     "GPX",
		".zip":     "ZIP Archive",
	}

	if format, ok := formatMap[ext]; ok {
		return format
	}
	return "Unknown"
}

// GenerateOutputPath generates an output path for the converted file
func GenerateOutputPath(sourcePath string, conversionType ConversionType) string {
	dir := filepath.Dir(sourcePath)
	base := filepath.Base(sourcePath)

	// Remove existing extension
	ext := filepath.Ext(base)
	nameWithoutExt := strings.TrimSuffix(base, ext)

	// Add cloud-native extension
	outputExt := conversionType.OutputExtension()
	if outputExt == "" {
		return sourcePath // No conversion
	}

	return filepath.Join(dir, nameWithoutExt+outputExt)
}
