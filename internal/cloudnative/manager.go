package cloudnative

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Manager manages cloud-native format conversion jobs
type Manager struct {
	jobs      map[string]*ConversionJob
	stopChans map[string]chan struct{}
	mu        sync.RWMutex
}

// NewManager creates a new conversion job manager
func NewManager() *Manager {
	return &Manager{
		jobs:      make(map[string]*ConversionJob),
		stopChans: make(map[string]chan struct{}),
	}
}

// StartJob starts a new conversion job
func (m *Manager) StartJob(sourcePath string, targetFormat ConversionType, opts ConversionOptions) (*ConversionJob, error) {
	// Generate output path
	outputPath := GenerateOutputPath(sourcePath, targetFormat)

	// Get source file info
	stat, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat source file: %w", err)
	}

	job := &ConversionJob{
		ID:           uuid.New().String(),
		SourcePath:   sourcePath,
		OutputPath:   outputPath,
		SourceFormat: GetSourceFormat(sourcePath),
		TargetFormat: targetFormat,
		Status:       JobStatusPending,
		Progress:     0,
		Message:      "Queued for conversion",
		StartedAt:    time.Now(),
		InputSize:    stat.Size(),
	}

	m.mu.Lock()
	m.jobs[job.ID] = job
	stopChan := make(chan struct{})
	m.stopChans[job.ID] = stopChan
	m.mu.Unlock()

	// Start conversion in background
	go m.runJob(job, opts, stopChan)

	return job, nil
}

// runJob executes the conversion job
func (m *Manager) runJob(job *ConversionJob, opts ConversionOptions, stopChan chan struct{}) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Listen for stop signal
	go func() {
		<-stopChan
		cancel()
	}()

	m.updateJobStatus(job.ID, JobStatusRunning, 0, "Starting conversion...")

	// Progress callback
	progress := func(p int, msg string) {
		if p >= 0 {
			m.updateJobProgress(job.ID, p, msg)
		} else {
			m.updateJobMessage(job.ID, msg)
		}
	}

	var err error
	switch job.TargetFormat {
	case ConversionCOG:
		err = ConvertToCOG(ctx, job.SourcePath, job.OutputPath, opts, progress)
	case ConversionCOPC:
		err = ConvertToCOPC(ctx, job.SourcePath, job.OutputPath, opts, progress)
	case ConversionGeoParquet:
		err = ConvertToGeoParquet(ctx, job.SourcePath, job.OutputPath, opts, progress)
	default:
		err = fmt.Errorf("unsupported conversion type: %s", job.TargetFormat)
	}

	if ctx.Err() != nil {
		m.updateJobStatus(job.ID, JobStatusCancelled, job.Progress, "Conversion cancelled")
		return
	}

	if err != nil {
		m.updateJobError(job.ID, err.Error())
		return
	}

	// Get output file size
	if stat, err := os.Stat(job.OutputPath); err == nil {
		m.mu.Lock()
		if j, ok := m.jobs[job.ID]; ok {
			j.OutputSize = stat.Size()
		}
		m.mu.Unlock()
	}

	m.updateJobStatus(job.ID, JobStatusCompleted, 100, "Conversion complete")
}

// updateJobStatus updates the job status
func (m *Manager) updateJobStatus(id string, status JobStatus, progress int, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.Status = status
		job.Progress = progress
		job.Message = message
		if status == JobStatusCompleted || status == JobStatusFailed || status == JobStatusCancelled {
			job.CompletedAt = time.Now()
		}
	}
}

// updateJobProgress updates the job progress
func (m *Manager) updateJobProgress(id string, progress int, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.Progress = progress
		job.Message = message
	}
}

// updateJobMessage updates the job message without changing progress
func (m *Manager) updateJobMessage(id string, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.Message = message
	}
}

// updateJobError marks the job as failed
func (m *Manager) updateJobError(id string, errMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.Status = JobStatusFailed
		job.Error = errMsg
		job.Message = "Conversion failed"
		job.CompletedAt = time.Now()
	}
}

// GetJob returns a job by ID
func (m *Manager) GetJob(id string) *ConversionJob {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if job, ok := m.jobs[id]; ok {
		// Return a copy to avoid race conditions
		copy := *job
		return &copy
	}
	return nil
}

// ListJobs returns all jobs
func (m *Manager) ListJobs() []*ConversionJob {
	m.mu.RLock()
	defer m.mu.RUnlock()

	jobs := make([]*ConversionJob, 0, len(m.jobs))
	for _, job := range m.jobs {
		copy := *job
		jobs = append(jobs, &copy)
	}
	return jobs
}

// ListActiveJobs returns jobs that are pending or running
func (m *Manager) ListActiveJobs() []*ConversionJob {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var jobs []*ConversionJob
	for _, job := range m.jobs {
		if job.Status == JobStatusPending || job.Status == JobStatusRunning {
			copy := *job
			jobs = append(jobs, &copy)
		}
	}
	return jobs
}

// CancelJob cancels a running or pending job
func (m *Manager) CancelJob(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	job, ok := m.jobs[id]
	if !ok {
		return false
	}

	if job.Status != JobStatusPending && job.Status != JobStatusRunning {
		return false // Can only cancel pending or running jobs
	}

	// Signal stop
	if stopChan, ok := m.stopChans[id]; ok {
		close(stopChan)
		delete(m.stopChans, id)
	}

	return true
}

// RemoveJob removes a completed/failed/cancelled job from the list
func (m *Manager) RemoveJob(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	job, ok := m.jobs[id]
	if !ok {
		return false
	}

	// Only remove completed, failed, or cancelled jobs
	if job.Status == JobStatusPending || job.Status == JobStatusRunning {
		return false
	}

	delete(m.jobs, id)
	delete(m.stopChans, id)
	return true
}

// CleanupOldJobs removes jobs older than the specified duration
func (m *Manager) CleanupOldJobs(maxAge time.Duration) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	removed := 0

	for id, job := range m.jobs {
		// Skip active jobs
		if job.Status == JobStatusPending || job.Status == JobStatusRunning {
			continue
		}

		// Remove old completed jobs
		if job.CompletedAt.Before(cutoff) {
			delete(m.jobs, id)
			delete(m.stopChans, id)
			removed++
		}
	}

	return removed
}

// GetToolStatus returns the availability status of conversion tools
func GetToolStatus() map[string]ToolInfo {
	status := make(map[string]ToolInfo)

	if available, version := CheckGDALAvailable(); available {
		status["gdal"] = ToolInfo{
			Available: true,
			Version:   version,
			Tool:      "gdal_translate",
			Formats:   []string{"COG", "GeoTIFF", "PNG", "JPEG"},
		}
	} else {
		status["gdal"] = ToolInfo{
			Available: false,
			Tool:      "gdal_translate",
			Error:     "GDAL not found in PATH",
		}
	}

	if available, version := CheckPDALAvailable(); available {
		status["pdal"] = ToolInfo{
			Available: true,
			Version:   version,
			Tool:      "pdal",
			Formats:   []string{"COPC", "LAS", "LAZ"},
		}
	} else {
		status["pdal"] = ToolInfo{
			Available: false,
			Tool:      "pdal",
			Error:     "PDAL not found in PATH",
		}
	}

	if available, version := CheckOGR2OGRAvailable(); available {
		info := ToolInfo{
			Available: true,
			Version:   version,
			Tool:      "ogr2ogr",
			Formats:   []string{"GeoParquet", "Shapefile", "GeoJSON", "GeoPackage"},
		}
		// Check for Parquet support
		if CheckParquetSupport() {
			info.Formats = append(info.Formats, "Parquet")
		}
		status["ogr2ogr"] = info
	} else {
		status["ogr2ogr"] = ToolInfo{
			Available: false,
			Tool:      "ogr2ogr",
			Error:     "ogr2ogr not found in PATH",
		}
	}

	return status
}

// ToolInfo contains information about a conversion tool
type ToolInfo struct {
	Available bool     `json:"available"`
	Version   string   `json:"version,omitempty"`
	Tool      string   `json:"tool"`
	Formats   []string `json:"formats,omitempty"`
	Error     string   `json:"error,omitempty"`
}
