package webserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/terria"
)

// handleTerriaConnection exports an entire connection as Terria catalog
// GET /api/terria/connection/{connId}
func (s *Server) handleTerriaConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	connID, _, _ := parsePathParams(r.URL.Path, "/api/terria/connection")
	if connID == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	// Set proxy URL based on request host
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	catalog, err := exporter.ExportConnection()
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, catalog)
}

// handleTerriaWorkspace exports a workspace as Terria catalog
// GET /api/terria/workspace/{connId}/{workspace}
func (s *Server) handleTerriaWorkspace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	connID, workspace, _ := parsePathParams(r.URL.Path, "/api/terria/workspace")
	if connID == "" || workspace == "" {
		s.jsonError(w, "Connection ID and workspace required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	catalog, err := exporter.ExportWorkspace(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, catalog)
}

// handleTerriaLayer exports a layer as Terria WMS item
// GET /api/terria/layer/{connId}/{workspace}/{layer}
func (s *Server) handleTerriaLayer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	connID, workspace, layer := parsePathParams(r.URL.Path, "/api/terria/layer")
	if connID == "" || workspace == "" || layer == "" {
		s.jsonError(w, "Connection ID, workspace, and layer required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	catalog, err := exporter.ExportLayer(workspace, layer)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, catalog)
}

// handleTerriaLayerGroup exports a layer group as Terria WMS item
// GET /api/terria/layergroup/{connId}/{workspace}/{groupName}
func (s *Server) handleTerriaLayerGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	connID, workspace, groupName := parsePathParams(r.URL.Path, "/api/terria/layergroup")
	if connID == "" || workspace == "" || groupName == "" {
		s.jsonError(w, "Connection ID, workspace, and group name required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	catalog, err := exporter.ExportLayerGroup(workspace, groupName)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, catalog)
}

// handleTerriaStory exports a layer group as a Terria "story" with individual layers
// GET /api/terria/story/{connId}/{workspace}/{groupName}
func (s *Server) handleTerriaStory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	connID, workspace, groupName := parsePathParams(r.URL.Path, "/api/terria/story")
	if connID == "" || workspace == "" || groupName == "" {
		s.jsonError(w, "Connection ID, workspace, and group name required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	initFile, err := exporter.ExportLayerGroupAsStory(workspace, groupName)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, initFile)
}

// handleTerriaInit generates a complete Terria init file
// GET /api/terria/init/{connId}.json
// GET /api/terria/init/{connId}/{workspace}.json
func (s *Server) handleTerriaInit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/terria/init/")
	path = strings.TrimSuffix(path, ".json")
	parts := strings.Split(path, "/")

	if len(parts) == 0 || parts[0] == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	connID := parts[0]
	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)
	proxyURL := fmt.Sprintf("http://%s/api/terria/proxy", r.Host)
	exporter.SetProxyURL(proxyURL)

	var members []terria.CatalogMember
	var err error

	if len(parts) == 1 {
		// Export entire connection
		group, exportErr := exporter.ExportConnection()
		if exportErr != nil {
			err = exportErr
		} else {
			members = []terria.CatalogMember{group}
		}
	} else if len(parts) >= 2 {
		// Export specific workspace
		workspace := parts[1]
		group, exportErr := exporter.ExportWorkspace(workspace)
		if exportErr != nil {
			err = exportErr
		} else {
			members = []terria.CatalogMember{group}
		}
	}

	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	initFile := exporter.ExportToInitFile(members)
	s.jsonResponse(w, initFile)
}

// handleTerriaProxy proxies requests to external servers (for CORS)
// GET /api/terria/proxy?url={encodedURL}
func (s *Server) handleTerriaProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		s.jsonError(w, "Missing 'url' parameter", http.StatusBadRequest)
		return
	}

	// Parse the target URL
	parsed, err := url.Parse(targetURL)
	if err != nil {
		s.jsonError(w, "Invalid URL", http.StatusBadRequest)
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
		s.jsonError(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}

	// Copy headers (except Host)
	for key, values := range r.Header {
		if key != "Host" {
			for _, v := range values {
				proxyReq.Header.Add(key, v)
			}
		}
	}

	// Find credentials for the target domain and add auth
	s.addProxyCredentials(proxyReq, parsed.Host)

	// Execute the request
	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(proxyReq)
	if err != nil {
		s.jsonError(w, "Proxy request failed: "+err.Error(), http.StatusBadGateway)
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

// addProxyCredentials adds authentication if we have credentials for the target host
func (s *Server) addProxyCredentials(req *http.Request, host string) {
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

// handleTerriaURL generates a Terria URL for opening in browser
// GET /api/terria/url/{connId}
// GET /api/terria/url/{connId}/{workspace}
// GET /api/terria/url/{connId}/{workspace}/{layer}
func (s *Server) handleTerriaURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/terria/url/")
	parts := strings.Split(strings.TrimSuffix(path, "/"), "/")

	if len(parts) == 0 || parts[0] == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	connID := parts[0]
	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	// Build the init URL based on path parameters
	var initPath string
	switch len(parts) {
	case 1:
		initPath = fmt.Sprintf("/api/terria/init/%s.json", connID)
	case 2:
		initPath = fmt.Sprintf("/api/terria/init/%s/%s.json", connID, parts[1])
	default:
		// For layers/layer groups, use the layer catalog endpoint
		initPath = fmt.Sprintf("/api/terria/layer/%s/%s/%s", connID, parts[1], parts[2])
	}

	// Build the full Terria URL
	baseURL := fmt.Sprintf("http://%s", r.Host)
	terriaURL := fmt.Sprintf("%s/#%s%s", baseURL, baseURL, initPath)

	// Also provide NationalMap URL option
	nationalMapURL := fmt.Sprintf("https://nationalmap.gov.au/#%s%s", baseURL, initPath)

	response := map[string]string{
		"localTerriaUrl":  terriaURL,
		"nationalMapUrl":  nationalMapURL,
		"initUrl":         baseURL + initPath,
		"catalogEndpoint": baseURL + initPath,
	}

	s.jsonResponse(w, response)
}

// handleTerriaViewer serves the embedded Cesium-based 3D viewer
// GET /viewer/
func (s *Server) handleTerriaViewer(w http.ResponseWriter, r *http.Request) {
	// Serve the embedded index.html from terria package
	html := terria.GetViewerHTML()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

// handleTerriaDownload returns Terria catalog JSON as a downloadable file
// GET /api/terria/download/{connId}
// GET /api/terria/download/{connId}/{workspace}
func (s *Server) handleTerriaDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/terria/download/")
	parts := strings.Split(strings.TrimSuffix(path, "/"), "/")

	if len(parts) == 0 || parts[0] == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	connID := parts[0]
	client := s.getClient(connID)
	conn := s.getConnectionConfig(connID)
	if client == nil || conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	exporter := terria.NewExporter(client, conn)

	var members []terria.CatalogMember
	var filename string
	var err error

	if len(parts) == 1 {
		// Export entire connection
		group, exportErr := exporter.ExportConnection()
		if exportErr != nil {
			err = exportErr
		} else {
			members = []terria.CatalogMember{group}
			filename = fmt.Sprintf("%s-terria-catalog.json", conn.Name)
		}
	} else if len(parts) >= 2 {
		// Export specific workspace
		workspace := parts[1]
		group, exportErr := exporter.ExportWorkspace(workspace)
		if exportErr != nil {
			err = exportErr
		} else {
			members = []terria.CatalogMember{group}
			filename = fmt.Sprintf("%s-%s-terria-catalog.json", conn.Name, workspace)
		}
	}

	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	initFile := exporter.ExportToInitFile(members)

	// Set headers for file download
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))

	json.NewEncoder(w).Encode(initFile)
}
