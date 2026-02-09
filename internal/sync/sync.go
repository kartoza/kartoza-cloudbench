// Package sync provides server synchronization functionality shared between TUI and Web UI
package sync

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/cache"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
)

// Task represents a running sync task
type Task struct {
	ID           string     `json:"id"`
	ConfigID     string     `json:"configId"`
	SourceID     string     `json:"sourceId"`
	DestID       string     `json:"destId"`
	Status       string     `json:"status"` // running, completed, failed, stopped
	Progress     float64    `json:"progress"`
	CurrentItem  string     `json:"currentItem"`
	ItemsTotal   int        `json:"itemsTotal"`
	ItemsDone    int        `json:"itemsDone"`
	ItemsSkipped int        `json:"itemsSkipped"`
	ItemsFailed  int        `json:"itemsFailed"`
	StartedAt    time.Time  `json:"startedAt"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
	Error        string     `json:"error,omitempty"`
	Log          []string   `json:"log"`

	mu sync.Mutex
}

// Manager manages running sync tasks
type Manager struct {
	tasks     map[string]*Task
	stopChans map[string]chan struct{}
	mu        sync.RWMutex
}

// NewManager creates a new sync manager
func NewManager() *Manager {
	return &Manager{
		tasks:     make(map[string]*Task),
		stopChans: make(map[string]chan struct{}),
	}
}

// Global manager instance
var DefaultManager = NewManager()

// StartSync starts a sync operation for a single destination
func (m *Manager) StartSync(sourceConn, destConn *config.Connection, options config.SyncOptions, configID string) *Task {
	task := &Task{
		ID:        uuid.New().String(),
		ConfigID:  configID,
		SourceID:  sourceConn.ID,
		DestID:    destConn.ID,
		Status:    "running",
		StartedAt: time.Now(),
		Log:       []string{fmt.Sprintf("Starting sync from %s to %s", sourceConn.Name, destConn.Name)},
	}

	stopChan := make(chan struct{})
	m.mu.Lock()
	m.tasks[task.ID] = task
	m.stopChans[task.ID] = stopChan
	m.mu.Unlock()

	// Start sync in goroutine
	go m.runSync(task, sourceConn, destConn, options, stopChan)

	return task
}

// GetTask returns a specific task
func (m *Manager) GetTask(id string) *Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tasks[id]
}

// GetAllTasks returns all tasks
func (m *Manager) GetAllTasks() []*Task {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tasks := make([]*Task, 0, len(m.tasks))
	for _, task := range m.tasks {
		tasks = append(tasks, task)
	}
	return tasks
}

// StopTask stops a specific task
func (m *Manager) StopTask(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	stopChan, exists := m.stopChans[id]
	if !exists {
		return false
	}

	close(stopChan)
	delete(m.stopChans, id)

	if task, ok := m.tasks[id]; ok {
		task.mu.Lock()
		task.Status = "stopped"
		task.Log = append(task.Log, "Sync stopped by user")
		task.mu.Unlock()
	}

	return true
}

// StopAllTasks stops all running tasks
func (m *Manager) StopAllTasks() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, stopChan := range m.stopChans {
		close(stopChan)
		delete(m.stopChans, id)
		if task, ok := m.tasks[id]; ok {
			task.mu.Lock()
			task.Status = "stopped"
			task.Log = append(task.Log, "Sync stopped by user")
			task.mu.Unlock()
		}
	}
}

// ClearCompletedTasks removes completed/failed/stopped tasks
func (m *Manager) ClearCompletedTasks() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, task := range m.tasks {
		if task.Status != "running" {
			delete(m.tasks, id)
		}
	}
}

// Task helper methods

// AddLog adds a log entry to the task
func (t *Task) AddLog(msg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Log = append(t.Log, fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), msg))
}

// SetError sets the task to failed status with an error message
func (t *Task) SetError(msg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Status = "failed"
	t.Error = msg
	t.Log = append(t.Log, fmt.Sprintf("[%s] ERROR: %s", time.Now().Format("15:04:05"), msg))
}

// UpdateProgress updates the task progress
func (t *Task) UpdateProgress() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.ItemsTotal > 0 {
		t.Progress = float64(t.ItemsDone+t.ItemsSkipped+t.ItemsFailed) / float64(t.ItemsTotal) * 100
	}
}

// SetCurrentItem sets the current item being processed
func (t *Task) SetCurrentItem(item string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.CurrentItem = item
}

// IncrementTotal increments the total items count
func (t *Task) IncrementTotal() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ItemsTotal++
}

// IncrementDone increments the done items count
func (t *Task) IncrementDone() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ItemsDone++
}

// IncrementSkipped increments the skipped items count
func (t *Task) IncrementSkipped() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ItemsSkipped++
}

// IncrementFailed increments the failed items count
func (t *Task) IncrementFailed() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ItemsFailed++
}

// GetStatus returns the current status (thread-safe)
func (t *Task) GetStatus() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Status
}

// GetProgress returns the current progress (thread-safe)
func (t *Task) GetProgress() float64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Progress
}

// GetCurrentItem returns the current item (thread-safe)
func (t *Task) GetCurrentItem() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.CurrentItem
}

// GetLogs returns a copy of the log entries (thread-safe)
func (t *Task) GetLogs() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	logs := make([]string, len(t.Log))
	copy(logs, t.Log)
	return logs
}

// runSync performs the actual sync operation
func (m *Manager) runSync(task *Task, source, dest *config.Connection, options config.SyncOptions, stopChan chan struct{}) {
	defer func() {
		task.mu.Lock()
		now := time.Now()
		task.CompletedAt = &now
		if task.Status == "running" {
			task.Status = "completed"
		}
		task.mu.Unlock()
	}()

	sourceClient := api.NewClient(source)
	destClient := api.NewClient(dest)

	// Get or create cache manager
	cacheManager := cache.DefaultManager
	if cacheManager == nil {
		var err error
		cacheManager, err = cache.NewManager()
		if err != nil {
			task.AddLog(fmt.Sprintf("Warning: cache unavailable: %v", err))
		}
	}

	executor := &Executor{
		task:         task,
		sourceClient: sourceClient,
		destClient:   destClient,
		options:      options,
		stopChan:     stopChan,
		sourceID:     source.ID,
		cacheManager: cacheManager,
	}

	executor.Execute()
}
