package webserver

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/kartoza/kartoza-cloudbench/internal/api"
	"github.com/kartoza/kartoza-cloudbench/internal/cloudnative"
	"github.com/kartoza/kartoza-cloudbench/internal/config"
	"github.com/kartoza/kartoza-cloudbench/internal/preview"
	"github.com/kartoza/kartoza-cloudbench/internal/s3client"
)

//go:embed static/*
var staticFiles embed.FS

// Server represents the web server
type Server struct {
	config        *config.Config
	clients       map[string]*api.Client       // GeoServer Connection ID -> Client
	s3Clients     map[string]*s3client.Client  // S3 Connection ID -> Client
	clientsMu     sync.RWMutex
	s3ClientsMu   sync.RWMutex
	previewServer *preview.Server
	conversionMgr *cloudnative.Manager
	addr          string
}

// New creates a new web server
func New(cfg *config.Config) *Server {
	s := &Server{
		config:        cfg,
		clients:       make(map[string]*api.Client),
		s3Clients:     make(map[string]*s3client.Client),
		conversionMgr: cloudnative.NewManager(),
	}

	// Initialize clients for existing GeoServer connections
	for _, conn := range cfg.Connections {
		client := api.NewClient(&conn)
		s.clients[conn.ID] = client
	}

	// Initialize clients for existing S3 connections
	for _, conn := range cfg.S3Connections {
		if client, err := s3client.NewClient(&conn); err == nil {
			s.s3Clients[conn.ID] = client
		}
	}

	return s
}

// Start starts the web server
func (s *Server) Start(addr string) error {
	s.addr = addr

	mux := http.NewServeMux()
	s.setupRoutes(mux)

	log.Printf("Starting web server on %s", addr)
	return http.ListenAndServe(addr, mux)
}

// setupRoutes sets up all HTTP routes
func (s *Server) setupRoutes(mux *http.ServeMux) {
	// API routes - connections
	mux.HandleFunc("/api/connections", s.handleConnections)
	mux.HandleFunc("/api/connections/test", s.handleTestConnectionDirect) // Test without saving
	mux.HandleFunc("/api/connections/", s.handleConnectionByID)

	// API routes - workspaces (pattern: /api/connections/{connId}/workspaces)
	mux.HandleFunc("/api/workspaces/", s.handleWorkspaces)

	// API routes - data stores
	mux.HandleFunc("/api/datastores/", s.handleDataStores)

	// API routes - coverage stores
	mux.HandleFunc("/api/coveragestores/", s.handleCoverageStores)

	// API routes - layers
	mux.HandleFunc("/api/layers/", s.handleLayers)

	// API routes - layer metadata (comprehensive)
	mux.HandleFunc("/api/layermetadata/", s.handleLayerMetadata)

	// API routes - layer styles association
	mux.HandleFunc("/api/layerstyles/", s.handleLayerStyles)

	// API routes - styles
	mux.HandleFunc("/api/styles/", s.handleStyles)

	// API routes - layer groups
	mux.HandleFunc("/api/layergroups/", s.handleLayerGroups)

	// API routes - feature types
	mux.HandleFunc("/api/featuretypes/", s.handleFeatureTypes)

	// API routes - coverages
	mux.HandleFunc("/api/coverages/", s.handleCoverages)

	// API routes - upload
	mux.HandleFunc("/api/upload", s.handleUpload)

	// API routes - preview
	mux.HandleFunc("/api/preview", s.handlePreview)
	mux.HandleFunc("/api/layer", s.handleLayerInfo)
	mux.HandleFunc("/api/metadata", s.handleMetadata)

	// API routes - GeoWebCache (GWC)
	mux.HandleFunc("/api/gwc/layers/", s.handleGWCLayers)
	mux.HandleFunc("/api/gwc/seed/", s.handleGWCSeed)
	mux.HandleFunc("/api/gwc/truncate/", s.handleGWCTruncate)
	mux.HandleFunc("/api/gwc/gridsets/", s.handleGWCGridSets)
	mux.HandleFunc("/api/gwc/diskquota/", s.handleGWCDiskQuota)

	// API routes - Settings
	mux.HandleFunc("/api/settings/", s.handleSettings)

	// API routes - Sync (server replication)
	mux.HandleFunc("/api/sync/configs", s.handleSyncConfigs)
	mux.HandleFunc("/api/sync/configs/", s.handleSyncConfigs)
	mux.HandleFunc("/api/sync/start", s.handleSyncStart)
	mux.HandleFunc("/api/sync/status", s.handleSyncStatus)
	mux.HandleFunc("/api/sync/status/", s.handleSyncStatus)
	mux.HandleFunc("/api/sync/stop", s.handleSyncStop)
	mux.HandleFunc("/api/sync/stop/", s.handleSyncStop)

	// API routes - Dashboard (server status overview)
	mux.HandleFunc("/api/dashboard", s.handleDashboard)
	mux.HandleFunc("/api/dashboard/server", s.handleServerStatus)

	// API routes - Download (export resources)
	mux.HandleFunc("/api/download/logs/", s.handleDownloadLogs)
	mux.HandleFunc("/api/download/", s.handleDownload)

	// API routes - Universal Search
	mux.HandleFunc("/api/search", s.handleSearch)
	mux.HandleFunc("/api/search/suggestions", s.handleSearchSuggestions)

	// API routes - Documentation
	mux.HandleFunc("/api/docs", s.handleDocumentation)

	// API routes - PostgreSQL Services
	mux.HandleFunc("/api/pg/services", s.handlePGServices)
	mux.HandleFunc("/api/pg/services/", s.handlePGServiceByName)

	// API routes - S3 Storage
	mux.HandleFunc("/api/s3/connections", s.handleS3Connections)
	mux.HandleFunc("/api/s3/connections/test", s.handleTestS3ConnectionDirect)
	mux.HandleFunc("/api/s3/connections/", s.handleS3ConnectionByID)
	mux.HandleFunc("/api/s3/conversion/tools", s.handleConversionToolStatus)
	mux.HandleFunc("/api/s3/conversion/jobs", s.handleConversionJobs)
	mux.HandleFunc("/api/s3/conversion/jobs/", s.handleConversionJobByID)
	mux.HandleFunc("/api/s3/preview/", s.handleS3Preview)
	mux.HandleFunc("/api/s3/proxy/", s.handleS3Proxy)

	// API routes - Data Import (ogr2ogr and raster2pgsql)
	mux.HandleFunc("/api/pg/import", s.handlePGImport)
	mux.HandleFunc("/api/pg/import/raster", s.handlePGRasterImport)
	mux.HandleFunc("/api/pg/import/upload", s.handlePGImportUpload)
	mux.HandleFunc("/api/pg/import/", s.handlePGImportStatus)
	mux.HandleFunc("/api/pg/detect-layers", s.handlePGDetectLayers)
	mux.HandleFunc("/api/pg/ogr2ogr/status", s.handleOgr2ogrStatus)

	// API routes - PostgreSQL to GeoServer Bridge
	mux.HandleFunc("/api/bridge", s.handleBridge)
	mux.HandleFunc("/api/bridge/", s.handleBridge)

	// API routes - AI Query Engine
	mux.HandleFunc("/api/ai/", s.handleAI)

	// API routes - Visual Query Designer
	mux.HandleFunc("/api/query/", s.handleQuery)

	// API routes - SQL View Layers (publish queries as GeoServer layers)
	mux.HandleFunc("/api/sqlview/", s.handleSQLView)
	mux.HandleFunc("/api/sqlview", s.handleSQLView)

	// API routes - Terria Integration (3D globe viewer, catalog export)
	mux.HandleFunc("/api/terria/connection/", s.handleTerriaConnection)
	mux.HandleFunc("/api/terria/workspace/", s.handleTerriaWorkspace)
	mux.HandleFunc("/api/terria/layer/", s.handleTerriaLayer)
	mux.HandleFunc("/api/terria/layergroup/", s.handleTerriaLayerGroup)
	mux.HandleFunc("/api/terria/story/", s.handleTerriaStory)
	mux.HandleFunc("/api/terria/init/", s.handleTerriaInit)
	mux.HandleFunc("/api/terria/proxy", s.handleTerriaProxy)
	mux.HandleFunc("/api/terria/url/", s.handleTerriaURL)
	mux.HandleFunc("/api/terria/download/", s.handleTerriaDownload)

	// 3D Viewer - embedded Cesium-based viewer
	mux.HandleFunc("/viewer/", s.handleTerriaViewer)
	mux.HandleFunc("/viewer", s.handleTerriaViewer)

	// Serve static files (React app)
	mux.HandleFunc("/", s.serveStatic)
}

// serveStatic serves the React app and static files
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	// Try to serve from embedded static files
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	// Strip leading slash and add static prefix
	filePath := "static" + path

	// Try to open the file
	content, err := staticFiles.ReadFile(filePath)
	if err != nil {
		// File not found - serve index.html for SPA routing
		content, err = staticFiles.ReadFile("static/index.html")
		if err != nil {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		path = "/index.html"
	}

	// Set content type based on extension
	contentType := "text/html"
	switch {
	case strings.HasSuffix(path, ".js"):
		contentType = "application/javascript"
	case strings.HasSuffix(path, ".mjs"):
		contentType = "application/javascript"
	case strings.HasSuffix(path, ".css"):
		contentType = "text/css"
	case strings.HasSuffix(path, ".json"):
		contentType = "application/json"
	case strings.HasSuffix(path, ".svg"):
		contentType = "image/svg+xml"
	case strings.HasSuffix(path, ".png"):
		contentType = "image/png"
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		contentType = "image/jpeg"
	case strings.HasSuffix(path, ".gif"):
		contentType = "image/gif"
	case strings.HasSuffix(path, ".ico"):
		contentType = "image/x-icon"
	case strings.HasSuffix(path, ".woff"):
		contentType = "font/woff"
	case strings.HasSuffix(path, ".woff2"):
		contentType = "font/woff2"
	case strings.HasSuffix(path, ".glb"):
		contentType = "model/gltf-binary"
	case strings.HasSuffix(path, ".gltf"):
		contentType = "model/gltf+json"
	case strings.HasSuffix(path, ".ktx2"):
		contentType = "image/ktx2"
	case strings.HasSuffix(path, ".wasm"):
		contentType = "application/wasm"
	}

	w.Header().Set("Content-Type", contentType)
	w.Write(content)
}

// GetStaticFS returns a filesystem for serving static files (for development mode)
func GetStaticFS() fs.FS {
	sub, _ := fs.Sub(staticFiles, "static")
	return sub
}

// Helper methods for JSON responses

func (s *Server) jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func (s *Server) jsonError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// getClient returns the API client for a connection ID
func (s *Server) getClient(connID string) *api.Client {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return s.clients[connID]
}

// getConnectionConfig returns the connection config for an ID
func (s *Server) getConnectionConfig(connID string) *config.Connection {
	for i := range s.config.Connections {
		if s.config.Connections[i].ID == connID {
			return &s.config.Connections[i]
		}
	}
	return nil
}

// addClient adds a new API client for a connection
func (s *Server) addClient(conn *config.Connection) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	s.clients[conn.ID] = api.NewClient(conn)
}

// removeClient removes an API client
func (s *Server) removeClient(connID string) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	delete(s.clients, connID)
}

// parsePathParams extracts connection ID, workspace, and resource name from URL path
// Expected patterns:
//   /api/workspaces/{connId}
//   /api/workspaces/{connId}/{workspace}
//   /api/datastores/{connId}/{workspace}
//   /api/datastores/{connId}/{workspace}/{storeName}
func parsePathParams(path, prefix string) (connID, workspace, resource string) {
	// Remove prefix
	path = strings.TrimPrefix(path, prefix)
	path = strings.TrimPrefix(path, "/")
	path = strings.TrimSuffix(path, "/")

	parts := strings.Split(path, "/")
	if len(parts) >= 1 && parts[0] != "" {
		connID = parts[0]
	}
	if len(parts) >= 2 {
		workspace = parts[1]
	}
	if len(parts) >= 3 {
		resource = parts[2]
	}
	return
}

// parseStorePathParams extracts connection ID, workspace, store name, and resource from URL
// Pattern: /api/{type}/{connId}/{workspace}/{store}/{resource}
func parseStorePathParams(path, prefix string) (connID, workspace, store, resource string) {
	path = strings.TrimPrefix(path, prefix)
	path = strings.TrimPrefix(path, "/")
	path = strings.TrimSuffix(path, "/")

	parts := strings.Split(path, "/")
	if len(parts) >= 1 && parts[0] != "" {
		connID = parts[0]
	}
	if len(parts) >= 2 {
		workspace = parts[1]
	}
	if len(parts) >= 3 {
		store = parts[2]
	}
	if len(parts) >= 4 {
		resource = parts[3]
	}
	return
}

// saveConfig saves the configuration to disk
func (s *Server) saveConfig() error {
	return s.config.Save()
}

// generateConnectionID generates a unique connection ID
func generateConnectionID() string {
	return fmt.Sprintf("conn_%d", len(config.DefaultConfig().Connections)+1)
}

// S3 client management methods

// getS3Client returns the S3 client for a connection ID
func (s *Server) getS3Client(connID string) *s3client.Client {
	s.s3ClientsMu.RLock()
	defer s.s3ClientsMu.RUnlock()
	return s.s3Clients[connID]
}

// addS3Client adds a new S3 client for a connection
func (s *Server) addS3Client(conn *config.S3Connection) {
	client, err := s3client.NewClient(conn)
	if err != nil {
		log.Printf("Failed to create S3 client for %s: %v", conn.ID, err)
		return
	}
	s.s3ClientsMu.Lock()
	defer s.s3ClientsMu.Unlock()
	s.s3Clients[conn.ID] = client
}

// removeS3Client removes an S3 client
func (s *Server) removeS3Client(connID string) {
	s.s3ClientsMu.Lock()
	defer s.s3ClientsMu.Unlock()
	delete(s.s3Clients, connID)
}

// Conversion job handlers

// handleConversionToolStatus returns the status of conversion tools
func (s *Server) handleConversionToolStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.jsonResponse(w, cloudnative.GetToolStatus())
}

// handleConversionJobs handles listing conversion jobs
func (s *Server) handleConversionJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.jsonResponse(w, s.conversionMgr.ListJobs())
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleConversionJobByID handles operations on a specific conversion job
func (s *Server) handleConversionJobByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/s3/conversion/jobs/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		s.jsonError(w, "Job ID required", http.StatusBadRequest)
		return
	}

	jobID := parts[0]

	// Check for cancel action
	if len(parts) >= 2 && parts[1] == "cancel" {
		if r.Method == http.MethodPost {
			if s.conversionMgr.CancelJob(jobID) {
				s.jsonResponse(w, map[string]string{"status": "cancelled"})
			} else {
				s.jsonError(w, "Failed to cancel job", http.StatusBadRequest)
			}
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		job := s.conversionMgr.GetJob(jobID)
		if job == nil {
			s.jsonError(w, "Job not found", http.StatusNotFound)
			return
		}
		s.jsonResponse(w, job)
	case http.MethodDelete:
		if s.conversionMgr.RemoveJob(jobID) {
			w.WriteHeader(http.StatusNoContent)
		} else {
			s.jsonError(w, "Job not found or still running", http.StatusBadRequest)
		}
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
