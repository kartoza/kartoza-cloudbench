package cloudnative

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// ConvertToGeoParquet converts a vector file to GeoParquet using ogr2ogr
func ConvertToGeoParquet(ctx context.Context, inputPath, outputPath string, opts ConversionOptions, progress ProgressCallback) error {
	// Build ogr2ogr command for GeoParquet
	args := []string{
		"-f", "Parquet",
	}

	// Add compression option
	compression := opts.ParquetCompression
	if compression == "" {
		compression = "ZSTD"
	}
	args = append(args, "-lco", fmt.Sprintf("COMPRESSION=%s", compression))

	// Add row group size if specified
	if opts.ParquetRowGroup > 0 {
		args = append(args, "-lco", fmt.Sprintf("ROW_GROUP_SIZE=%d", opts.ParquetRowGroup))
	}

	// Add geometry encoding for GeoParquet
	args = append(args, "-lco", "GEOMETRY_ENCODING=WKB")

	// Output and input paths
	args = append(args, outputPath, inputPath)

	if progress != nil {
		progress(0, "Starting GeoParquet conversion...")
	}

	cmd := exec.CommandContext(ctx, "ogr2ogr", args...)

	// Capture stderr for progress/error messages
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to capture stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ogr2ogr: %w", err)
	}

	// Parse progress from stderr
	if progress != nil {
		go func() {
			scanner := bufio.NewScanner(stderr)
			progressRegex := regexp.MustCompile(`(\d+)\.+(\d+)`)
			for scanner.Scan() {
				line := scanner.Text()
				if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
					if p, err := strconv.Atoi(matches[1]); err == nil {
						progress(p, fmt.Sprintf("Converting to GeoParquet: %d%%", p))
					}
				}
			}
		}()
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ogr2ogr failed: %w", err)
	}

	if progress != nil {
		progress(100, "GeoParquet conversion complete")
	}

	return nil
}

// ValidateGeoParquet checks if a file is a valid GeoParquet file
func ValidateGeoParquet(ctx context.Context, filePath string) (bool, string, error) {
	// Use ogrinfo to check if it's a valid Parquet file
	cmd := exec.CommandContext(ctx, "ogrinfo", "-so", filePath)
	output, err := cmd.Output()
	if err != nil {
		return false, "", fmt.Errorf("ogrinfo failed: %w", err)
	}

	outputStr := string(output)

	// Check if ogrinfo recognized it as Parquet
	if strings.Contains(outputStr, "Parquet") || strings.Contains(outputStr, "parquet") {
		return true, "Valid GeoParquet file", nil
	}

	return false, "File is not a valid GeoParquet file", nil
}

// GetVectorInfo returns information about a vector file
func GetVectorInfo(ctx context.Context, filePath string) (*VectorInfo, error) {
	cmd := exec.CommandContext(ctx, "ogrinfo", "-so", "-al", filePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ogrinfo failed: %w", err)
	}

	info := &VectorInfo{
		Raw: string(output),
	}

	// Parse basic info from output
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "Layer name:") {
			info.LayerName = strings.TrimPrefix(line, "Layer name:")
			info.LayerName = strings.TrimSpace(info.LayerName)
		}
		if strings.HasPrefix(line, "Geometry:") {
			info.GeometryType = strings.TrimPrefix(line, "Geometry:")
			info.GeometryType = strings.TrimSpace(info.GeometryType)
		}
		if strings.HasPrefix(line, "Feature Count:") {
			countStr := strings.TrimPrefix(line, "Feature Count:")
			countStr = strings.TrimSpace(countStr)
			if count, err := strconv.ParseInt(countStr, 10, 64); err == nil {
				info.FeatureCount = count
			}
		}
	}

	return info, nil
}

// VectorInfo contains information about a vector file
type VectorInfo struct {
	LayerName    string `json:"layer_name,omitempty"`
	GeometryType string `json:"geometry_type,omitempty"`
	FeatureCount int64  `json:"feature_count,omitempty"`
	SRS          string `json:"srs,omitempty"`
	Extent       string `json:"extent,omitempty"`
	Raw          string `json:"raw,omitempty"`
}

// CheckOGR2OGRAvailable checks if ogr2ogr is available
func CheckOGR2OGRAvailable() (bool, string) {
	cmd := exec.Command("ogr2ogr", "--version")
	output, err := cmd.Output()
	if err != nil {
		return false, ""
	}
	return true, strings.TrimSpace(string(output))
}

// CheckParquetSupport checks if GDAL has Parquet driver support
func CheckParquetSupport() bool {
	cmd := exec.Command("ogrinfo", "--formats")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(output), "Parquet")
}

// ListGeoPackageLayers returns a list of layer names in a GeoPackage file
func ListGeoPackageLayers(ctx context.Context, gpkgPath string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "ogrinfo", "-so", "-q", gpkgPath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ogrinfo failed: %w", err)
	}

	var layers []string
	lines := strings.Split(string(output), "\n")
	// ogrinfo -so -q output format: "1: layer_name (geometry_type)"
	layerRegex := regexp.MustCompile(`^\d+:\s*(\S+)`)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if matches := layerRegex.FindStringSubmatch(line); len(matches) > 1 {
			layers = append(layers, matches[1])
		}
	}
	return layers, nil
}

// ConvertGeoPackageLayerToGeoParquet converts a single layer from a GeoPackage to GeoParquet
func ConvertGeoPackageLayerToGeoParquet(ctx context.Context, gpkgPath, layerName, outputPath string, opts ConversionOptions, progress ProgressCallback) error {
	// Build ogr2ogr command for specific layer
	args := []string{
		"-f", "Parquet",
	}

	// Add compression option
	compression := opts.ParquetCompression
	if compression == "" {
		compression = "ZSTD"
	}
	args = append(args, "-lco", fmt.Sprintf("COMPRESSION=%s", compression))

	// Add row group size if specified
	if opts.ParquetRowGroup > 0 {
		args = append(args, "-lco", fmt.Sprintf("ROW_GROUP_SIZE=%d", opts.ParquetRowGroup))
	}

	// Add geometry encoding for GeoParquet
	args = append(args, "-lco", "GEOMETRY_ENCODING=WKB")

	// Output and input paths with layer name
	args = append(args, outputPath, gpkgPath, layerName)

	if progress != nil {
		progress(0, fmt.Sprintf("Converting layer %s to GeoParquet...", layerName))
	}

	cmd := exec.CommandContext(ctx, "ogr2ogr", args...)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ogr2ogr failed for layer %s: %w", layerName, err)
	}

	if progress != nil {
		progress(100, fmt.Sprintf("Layer %s conversion complete", layerName))
	}

	return nil
}

// GeoPackageLayerInfo contains information about a layer in a GeoPackage
type GeoPackageLayerInfo struct {
	Name         string `json:"name"`
	GeometryType string `json:"geometryType,omitempty"`
	FeatureCount int64  `json:"featureCount,omitempty"`
}

// GetGeoPackageLayerInfo returns detailed info about layers in a GeoPackage
func GetGeoPackageLayerInfo(ctx context.Context, gpkgPath string) ([]GeoPackageLayerInfo, error) {
	cmd := exec.CommandContext(ctx, "ogrinfo", "-so", "-al", gpkgPath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ogrinfo failed: %w", err)
	}

	var layers []GeoPackageLayerInfo
	var currentLayer *GeoPackageLayerInfo

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "Layer name:") {
			if currentLayer != nil {
				layers = append(layers, *currentLayer)
			}
			currentLayer = &GeoPackageLayerInfo{
				Name: strings.TrimSpace(strings.TrimPrefix(line, "Layer name:")),
			}
		}
		if currentLayer != nil {
			if strings.HasPrefix(line, "Geometry:") {
				currentLayer.GeometryType = strings.TrimSpace(strings.TrimPrefix(line, "Geometry:"))
			}
			if strings.HasPrefix(line, "Feature Count:") {
				countStr := strings.TrimSpace(strings.TrimPrefix(line, "Feature Count:"))
				if count, err := strconv.ParseInt(countStr, 10, 64); err == nil {
					currentLayer.FeatureCount = count
				}
			}
		}
	}
	// Don't forget the last layer
	if currentLayer != nil {
		layers = append(layers, *currentLayer)
	}

	return layers, nil
}
