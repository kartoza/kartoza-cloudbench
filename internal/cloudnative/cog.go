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

// ConvertToCOG converts a raster file to Cloud Optimized GeoTIFF using GDAL
func ConvertToCOG(ctx context.Context, inputPath, outputPath string, opts ConversionOptions, progress ProgressCallback) error {
	// Set defaults
	blockSize := opts.COGBlockSize
	if blockSize <= 0 {
		blockSize = 512
	}
	compression := opts.COGCompression
	if compression == "" {
		compression = "LZW"
	}

	// Build gdal_translate command for COG
	args := []string{
		"-of", "COG",
		"-co", fmt.Sprintf("BLOCKSIZE=%d", blockSize),
		"-co", fmt.Sprintf("COMPRESS=%s", compression),
		"-co", "TILING_SCHEME=GoogleMapsCompatible",
		"-co", "OVERVIEW_RESAMPLING=AVERAGE",
	}

	// Add overviews if requested
	if opts.COGOverviews {
		args = append(args, "-co", "ADD_ALPHA=NO")
	}

	args = append(args, inputPath, outputPath)

	if progress != nil {
		progress(0, "Starting COG conversion...")
	}

	cmd := exec.CommandContext(ctx, "gdal_translate", args...)

	// Capture stderr for progress parsing
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to capture stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start gdal_translate: %w", err)
	}

	// Parse progress from stderr
	if progress != nil {
		go func() {
			scanner := bufio.NewScanner(stderr)
			progressRegex := regexp.MustCompile(`\.+(\d+)`)
			for scanner.Scan() {
				line := scanner.Text()
				if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
					if p, err := strconv.Atoi(matches[1]); err == nil {
						progress(p, fmt.Sprintf("Converting to COG: %d%%", p))
					}
				}
			}
		}()
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("gdal_translate failed: %w", err)
	}

	if progress != nil {
		progress(100, "COG conversion complete")
	}

	return nil
}

// ValidateCOG checks if a file is a valid Cloud Optimized GeoTIFF
func ValidateCOG(ctx context.Context, filePath string) (bool, string, error) {
	// Use GDAL's validate_cloud_optimized_geotiff.py if available
	// or check using gdalinfo

	cmd := exec.CommandContext(ctx, "gdalinfo", "-json", filePath)
	output, err := cmd.Output()
	if err != nil {
		return false, "", fmt.Errorf("gdalinfo failed: %w", err)
	}

	// Check for COG indicators in the output
	outputStr := string(output)
	isCOG := strings.Contains(outputStr, "LAYOUT=COG") ||
		strings.Contains(outputStr, "\"LAYOUT\": \"COG\"")

	if isCOG {
		return true, "Valid Cloud Optimized GeoTIFF", nil
	}

	return false, "File is not a Cloud Optimized GeoTIFF", nil
}

// CheckGDALAvailable checks if GDAL tools are available
func CheckGDALAvailable() (bool, string) {
	cmd := exec.Command("gdal_translate", "--version")
	output, err := cmd.Output()
	if err != nil {
		return false, ""
	}
	return true, strings.TrimSpace(string(output))
}

// GetGDALInfo returns information about a raster file
func GetGDALInfo(ctx context.Context, filePath string) (map[string]interface{}, error) {
	cmd := exec.CommandContext(ctx, "gdalinfo", "-json", filePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("gdalinfo failed: %w", err)
	}

	// Parse JSON output
	// For now, return raw string - caller can parse as needed
	result := map[string]interface{}{
		"raw": string(output),
	}
	return result, nil
}
