package webserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/sync"
)

// SyncConfigRequest represents a request to save/update a sync configuration
type SyncConfigRequest struct {
	ID       string             `json:"id,omitempty"`
	Name     string             `json:"name"`
	SourceID string             `json:"source_id"`
	DestIDs  []string           `json:"destination_ids"`
	Options  config.SyncOptions `json:"options"`
}

// StartSyncRequest represents a request to start syncing
type StartSyncRequest struct {
	ConfigID string              `json:"configId,omitempty"`        // Use saved config
	SourceID string              `json:"sourceId,omitempty"`        // Or specify inline
	DestIDs  []string            `json:"destinationIds,omitempty"`
	Options  *config.SyncOptions `json:"options,omitempty"`
}

// handleSyncConfigs handles sync configuration CRUD
func (s *Server) handleSyncConfigs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.getSyncConfigs(w, r)
	case http.MethodPost:
		s.createSyncConfig(w, r)
	case http.MethodPut:
		s.updateSyncConfig(w, r)
	case http.MethodDelete:
		s.deleteSyncConfig(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) getSyncConfigs(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Check if specific ID requested
	path := strings.TrimPrefix(r.URL.Path, "/api/sync/configs")
	path = strings.TrimPrefix(path, "/")
	if path != "" {
		syncCfg := cfg.GetSyncConfig(path)
		if syncCfg == nil {
			http.Error(w, "Sync configuration not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(syncCfg)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	// Ensure we return an empty array instead of null
	syncConfigs := cfg.SyncConfigs
	if syncConfigs == nil {
		syncConfigs = []config.SyncConfiguration{}
	}
	json.NewEncoder(w).Encode(syncConfigs)
}

func (s *Server) createSyncConfig(w http.ResponseWriter, r *http.Request) {
	var req SyncConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	syncCfg := config.SyncConfiguration{
		ID:          uuid.New().String(),
		Name:        req.Name,
		SourceID:    req.SourceID,
		DestIDs:     req.DestIDs,
		SyncOptions: req.Options,
		CreatedAt:   time.Now().Format(time.RFC3339),
	}

	cfg.AddSyncConfig(syncCfg)
	if err := cfg.Save(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(syncCfg)
}

func (s *Server) updateSyncConfig(w http.ResponseWriter, r *http.Request) {
	var req SyncConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	existing := cfg.GetSyncConfig(req.ID)
	if existing == nil {
		http.Error(w, "Sync configuration not found", http.StatusNotFound)
		return
	}

	syncCfg := config.SyncConfiguration{
		ID:           req.ID,
		Name:         req.Name,
		SourceID:     req.SourceID,
		DestIDs:      req.DestIDs,
		SyncOptions:  req.Options,
		CreatedAt:    existing.CreatedAt,
		LastSyncedAt: existing.LastSyncedAt,
	}

	cfg.UpdateSyncConfig(syncCfg)
	if err := cfg.Save(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(syncCfg)
}

func (s *Server) deleteSyncConfig(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/sync/configs/")
	if path == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	cfg.RemoveSyncConfig(path)
	if err := cfg.Save(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleSyncStart starts a sync operation
func (s *Server) handleSyncStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req StartSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var sourceID string
	var destIDs []string
	var options config.SyncOptions

	if req.ConfigID != "" {
		syncCfg := cfg.GetSyncConfig(req.ConfigID)
		if syncCfg == nil {
			http.Error(w, "Sync configuration not found", http.StatusNotFound)
			return
		}
		sourceID = syncCfg.SourceID
		destIDs = syncCfg.DestIDs
		options = syncCfg.SyncOptions
	} else {
		sourceID = req.SourceID
		destIDs = req.DestIDs
		if req.Options != nil {
			options = *req.Options
		} else {
			options = config.DefaultSyncOptions()
		}
	}

	if sourceID == "" || len(destIDs) == 0 {
		http.Error(w, "Source and at least one destination are required", http.StatusBadRequest)
		return
	}

	// Validate connections exist
	sourceConn := cfg.GetConnection(sourceID)
	if sourceConn == nil {
		http.Error(w, "Source connection not found", http.StatusBadRequest)
		return
	}

	// Start sync tasks for each destination using the shared sync package
	var tasks []*sync.Task
	for _, destID := range destIDs {
		destConn := cfg.GetConnection(destID)
		if destConn == nil {
			continue
		}

		task := sync.DefaultManager.StartSync(sourceConn, destConn, options, req.ConfigID)
		tasks = append(tasks, task)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// handleSyncStatus returns status of sync tasks
func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/sync/status")
	path = strings.TrimPrefix(path, "/")

	if path != "" {
		task := sync.DefaultManager.GetTask(path)
		if task == nil {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(task)
		return
	}

	// Return all tasks - ensure empty array not null
	tasks := sync.DefaultManager.GetAllTasks()
	if tasks == nil {
		tasks = []*sync.Task{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// handleSyncStop stops one or all sync tasks
func (s *Server) handleSyncStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/sync/stop")
	path = strings.TrimPrefix(path, "/")

	if path != "" {
		// Stop specific task
		if !sync.DefaultManager.StopTask(path) {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
	} else {
		// Stop all tasks
		sync.DefaultManager.StopAllTasks()
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}
