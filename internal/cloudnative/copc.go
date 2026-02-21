package cloudnative

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// ConvertToCOPC converts a point cloud file to Cloud Optimized Point Cloud using PDAL
func ConvertToCOPC(ctx context.Context, inputPath, outputPath string, opts ConversionOptions, progress ProgressCallback) error {
	// Build PDAL translate command for COPC
	// pdal translate input.las output.copc.laz --writers.copc.forward=all
	args := []string{
		"translate",
		inputPath,
		outputPath,
		"--writers.copc.forward=all",
	}

	// Add thread count if specified
	if opts.COPCThreads > 0 {
		args = append(args, fmt.Sprintf("--writers.copc.threads=%d", opts.COPCThreads))
	}

	if progress != nil {
		progress(0, "Starting COPC conversion...")
	}

	cmd := exec.CommandContext(ctx, "pdal", args...)

	// Capture stderr for progress/error messages
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to capture stderr: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to capture stdout: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start pdal: %w", err)
	}

	// Collect stderr output for error reporting
	var stderrLines []string
	var stderrMu sync.Mutex

	// Parse progress from output
	go func() {
		scanner := bufio.NewScanner(stderr)
		progressRegex := regexp.MustCompile(`(\d+)%`)
		for scanner.Scan() {
			line := scanner.Text()
			// Store all stderr lines for error reporting
			stderrMu.Lock()
			stderrLines = append(stderrLines, line)
			stderrMu.Unlock()

			if progress != nil {
				if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
					if p, err := strconv.Atoi(matches[1]); err == nil {
						progress(p, fmt.Sprintf("Converting to COPC: %d%%", p))
					}
				}
			}
		}
	}()
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if progress != nil {
				if strings.Contains(line, "Processing") || strings.Contains(line, "Writing") {
					progress(-1, line) // -1 indicates message update without progress change
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		errStr := err.Error()

		// Get collected stderr output
		stderrMu.Lock()
		stderrOutput := strings.Join(stderrLines, "\n")
		stderrMu.Unlock()

		// Check for OOM kill (signal: killed)
		if strings.Contains(errStr, "signal: killed") {
			return fmt.Errorf("pdal translate was killed (likely out of memory). Large LAZ files require significant RAM for COPC conversion. Try with a smaller file or increase system memory")
		}

		// Include stderr output in error message if available
		if stderrOutput != "" {
			return fmt.Errorf("pdal translate failed: %w\nPDAL output: %s", err, stderrOutput)
		}
		return fmt.Errorf("pdal translate failed: %w", err)
	}

	if progress != nil {
		progress(100, "COPC conversion complete")
	}

	return nil
}

// ValidateCOPC checks if a file is a valid Cloud Optimized Point Cloud
func ValidateCOPC(ctx context.Context, filePath string) (bool, string, error) {
	// Use pdal info to check if it's a COPC file
	cmd := exec.CommandContext(ctx, "pdal", "info", "--metadata", filePath)
	output, err := cmd.Output()
	if err != nil {
		return false, "", fmt.Errorf("pdal info failed: %w", err)
	}

	// Check for COPC indicators
	outputStr := string(output)
	isCOPC := strings.Contains(outputStr, "copc") ||
		strings.Contains(outputStr, "\"format\": \"copc\"")

	if isCOPC {
		return true, "Valid Cloud Optimized Point Cloud", nil
	}

	return false, "File is not a Cloud Optimized Point Cloud", nil
}

// CheckPDALAvailable checks if PDAL tools are available
func CheckPDALAvailable() (bool, string) {
	cmd := exec.Command("pdal", "--version")
	output, err := cmd.Output()
	if err != nil {
		return false, ""
	}
	return true, strings.TrimSpace(string(output))
}

// GetPointCloudInfo returns information about a point cloud file
func GetPointCloudInfo(ctx context.Context, filePath string) (map[string]interface{}, error) {
	cmd := exec.CommandContext(ctx, "pdal", "info", "--summary", filePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("pdal info failed: %w", err)
	}

	// Return raw JSON output - caller can parse as needed
	result := map[string]interface{}{
		"raw": string(output),
	}
	return result, nil
}

// GetPointCloudStats returns statistics about a point cloud file
func GetPointCloudStats(ctx context.Context, filePath string) (*PointCloudStats, error) {
	cmd := exec.CommandContext(ctx, "pdal", "info", "--stats", filePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("pdal info failed: %w", err)
	}

	// Parse basic stats from output
	// This is a simplified version - full implementation would parse JSON
	stats := &PointCloudStats{
		Raw: string(output),
	}

	return stats, nil
}

// PointCloudStats contains statistics about a point cloud
type PointCloudStats struct {
	PointCount int64   `json:"point_count,omitempty"`
	MinX       float64 `json:"min_x,omitempty"`
	MinY       float64 `json:"min_y,omitempty"`
	MinZ       float64 `json:"min_z,omitempty"`
	MaxX       float64 `json:"max_x,omitempty"`
	MaxY       float64 `json:"max_y,omitempty"`
	MaxZ       float64 `json:"max_z,omitempty"`
	SRS        string  `json:"srs,omitempty"`
	Raw        string  `json:"raw,omitempty"`
}
