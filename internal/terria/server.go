package terria

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
)

//go:embed static/*
var staticFiles embed.FS

// GetViewerHTML returns the embedded viewer HTML
func GetViewerHTML() string {
	data, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		return "<html><body><h1>Viewer not found</h1></body></html>"
	}
	return string(data)
}

// Server serves TerriaMap static files and provides proxy/catalog endpoints
type Server struct {
	config    *config.Config
	clients   map[string]*api.Client
	port      int
	server    *http.Server
	mux       *http.ServeMux
	mu        sync.RWMutex
	baseURL   string
	running   bool
}

// NewServer creates a new Terria server
func NewServer(cfg *config.Config, clients map[string]*api.Client, port int) *Server {
	return &Server{
		config:  cfg,
		clients: clients,
		port:    port,
		baseURL: fmt.Sprintf("http://localhost:%d", port),
	}
}

// Start starts the Terria server
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return nil
	}

	s.mux = http.NewServeMux()

	// Serve static TerriaMap files
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return fmt.Errorf("failed to access static files: %w", err)
	}
	s.mux.Handle("/", http.FileServer(http.FS(staticFS)))

	// API endpoints
	s.mux.HandleFunc("/api/catalog/connection/", s.handleConnectionCatalog)
	s.mux.HandleFunc("/api/catalog/workspace/", s.handleWorkspaceCatalog)
	s.mux.HandleFunc("/api/catalog/layer/", s.handleLayerCatalog)
	s.mux.HandleFunc("/api/catalog/layergroup/", s.handleLayerGroupCatalog)
	s.mux.HandleFunc("/api/catalog/story/", s.handleLayerGroupStory)

	// Proxy endpoint for CORS
	s.mux.HandleFunc("/proxy", s.handleProxy)

	// Init file endpoint (dynamic catalog generation)
	s.mux.HandleFunc("/init/", s.handleDynamicInit)

	s.server = &http.Server{
		Addr:         fmt.Sprintf(":%d", s.port),
		Handler:      s.mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Terria server error: %v\n", err)
		}
	}()

	s.running = true
	return nil
}

// Stop stops the Terria server
func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	if s.server != nil {
		s.server.Close()
	}
	s.running = false
	return nil
}

// IsRunning returns whether the server is running
func (s *Server) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// BaseURL returns the server's base URL
func (s *Server) BaseURL() string {
	return s.baseURL
}

// ProxyURL returns the proxy endpoint URL
func (s *Server) ProxyURL() string {
	return s.baseURL + "/proxy"
}

// GetTerriaURL returns a URL to open Terria with a specific catalog
func (s *Server) GetTerriaURL(initPath string) string {
	return fmt.Sprintf("%s/#%s%s", s.baseURL, s.baseURL, initPath)
}

// GetTerriaURLWithStart returns a URL with embedded start data
func (s *Server) GetTerriaURLWithStart(startData *StartData) (string, error) {
	jsonData, err := json.Marshal(startData)
	if err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(jsonData)
	return fmt.Sprintf("%s/#start=%s", s.baseURL, url.QueryEscape(encoded)), nil
}

// handleConnectionCatalog generates a catalog for an entire connection
func (s *Server) handleConnectionCatalog(w http.ResponseWriter, r *http.Request) {
	// URL: /api/catalog/connection/{connectionID}
	path := strings.TrimPrefix(r.URL.Path, "/api/catalog/connection/")
	connectionID := strings.TrimSuffix(path, "/")

	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	catalog, err := exporter.ExportConnection()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeJSON(w, catalog)
}

// handleWorkspaceCatalog generates a catalog for a workspace
func (s *Server) handleWorkspaceCatalog(w http.ResponseWriter, r *http.Request) {
	// URL: /api/catalog/workspace/{connectionID}/{workspace}
	path := strings.TrimPrefix(r.URL.Path, "/api/catalog/workspace/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	connectionID := parts[0]
	workspace := strings.TrimSuffix(parts[1], "/")

	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	catalog, err := exporter.ExportWorkspace(workspace)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeJSON(w, catalog)
}

// handleLayerCatalog generates a catalog item for a layer
func (s *Server) handleLayerCatalog(w http.ResponseWriter, r *http.Request) {
	// URL: /api/catalog/layer/{connectionID}/{workspace}/{layer}
	path := strings.TrimPrefix(r.URL.Path, "/api/catalog/layer/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) != 3 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	connectionID := parts[0]
	workspace := parts[1]
	layer := strings.TrimSuffix(parts[2], "/")

	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	catalog, err := exporter.ExportLayer(workspace, layer)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeJSON(w, catalog)
}

// handleLayerGroupCatalog generates a catalog item for a layer group
func (s *Server) handleLayerGroupCatalog(w http.ResponseWriter, r *http.Request) {
	// URL: /api/catalog/layergroup/{connectionID}/{workspace}/{groupName}
	path := strings.TrimPrefix(r.URL.Path, "/api/catalog/layergroup/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) != 3 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	connectionID := parts[0]
	workspace := parts[1]
	groupName := strings.TrimSuffix(parts[2], "/")

	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	catalog, err := exporter.ExportLayerGroup(workspace, groupName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeJSON(w, catalog)
}

// handleLayerGroupStory generates a "story" init file for a layer group
func (s *Server) handleLayerGroupStory(w http.ResponseWriter, r *http.Request) {
	// URL: /api/catalog/story/{connectionID}/{workspace}/{groupName}
	path := strings.TrimPrefix(r.URL.Path, "/api/catalog/story/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) != 3 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	connectionID := parts[0]
	workspace := parts[1]
	groupName := strings.TrimSuffix(parts[2], "/")

	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	initFile, err := exporter.ExportLayerGroupAsStory(workspace, groupName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.writeJSON(w, initFile)
}

// handleDynamicInit generates a dynamic init file
func (s *Server) handleDynamicInit(w http.ResponseWriter, r *http.Request) {
	// URL: /init/{connectionID}.json or /init/{connectionID}/{workspace}.json
	path := strings.TrimPrefix(r.URL.Path, "/init/")
	path = strings.TrimSuffix(path, ".json")
	parts := strings.Split(path, "/")

	if len(parts) == 0 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	connectionID := parts[0]
	client, conn := s.getClientAndConnection(connectionID)
	if client == nil {
		http.Error(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := NewExporter(client, conn)
	exporter.SetProxyURL(s.ProxyURL())

	var members []CatalogMember
	var err error

	if len(parts) == 1 {
		// Export entire connection
		group, exportErr := exporter.ExportConnection()
		if exportErr != nil {
			err = exportErr
		} else {
			members = []CatalogMember{group}
		}
	} else if len(parts) == 2 {
		// Export specific workspace
		workspace := parts[1]
		group, exportErr := exporter.ExportWorkspace(workspace)
		if exportErr != nil {
			err = exportErr
		} else {
			members = []CatalogMember{group}
		}
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	initFile := exporter.ExportToInitFile(members)
	s.writeJSON(w, initFile)
}

// handleProxy proxies requests to external servers (for CORS)
func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "Missing 'url' parameter", http.StatusBadRequest)
		return
	}

	// Parse the target URL
	parsed, err := url.Parse(targetURL)
	if err != nil {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}

	// Copy query parameters from the proxy request (except 'url')
	targetQuery := parsed.Query()
	for key, values := range r.URL.Query() {
		if key != "url" {
			for _, v := range values {
				targetQuery.Add(key, v)
			}
		}
	}
	parsed.RawQuery = targetQuery.Encode()

	// Create the proxied request
	proxyReq, err := http.NewRequest(r.Method, parsed.String(), r.Body)
	if err != nil {
		http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}

	// Copy headers
	for key, values := range r.Header {
		for _, v := range values {
			proxyReq.Header.Add(key, v)
		}
	}

	// Find credentials for the target domain
	s.addCredentials(proxyReq, parsed.Host)

	// Execute the request
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, "Proxy request failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}

	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")

	// Handle OPTIONS preflight
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// addCredentials adds authentication if we have credentials for the target host
func (s *Server) addCredentials(req *http.Request, host string) {
	for _, conn := range s.config.Connections {
		connURL, err := url.Parse(conn.URL)
		if err != nil {
			continue
		}
		if connURL.Host == host || strings.HasPrefix(host, connURL.Host) {
			req.SetBasicAuth(conn.Username, conn.Password)
			return
		}
	}
}

// getClientAndConnection returns the client and connection for a given ID
func (s *Server) getClientAndConnection(connectionID string) (*api.Client, *config.Connection) {
	client, ok := s.clients[connectionID]
	if !ok {
		return nil, nil
	}

	for i := range s.config.Connections {
		if s.config.Connections[i].ID == connectionID {
			return client, &s.config.Connections[i]
		}
	}
	return nil, nil
}

// writeJSON writes a JSON response
func (s *Server) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(data)
}
