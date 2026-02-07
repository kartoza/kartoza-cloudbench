package preview

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

//go:embed static/*
var staticFiles embed.FS

// LayerInfo contains information about a layer to preview
type LayerInfo struct {
	Name         string `json:"name"`
	Workspace    string `json:"workspace"`
	StoreName    string `json:"store_name"`
	StoreType    string `json:"store_type"` // "datastore" or "coveragestore"
	GeoServerURL string `json:"geoserver_url"`
	Type         string `json:"type"` // "vector" or "raster"
	// Credentials for REST API calls (not sent to client)
	Username string `json:"-"`
	Password string `json:"-"`
}

// Server provides an embedded HTTP server for layer previews
type Server struct {
	server    *http.Server
	listener  net.Listener
	layer     *LayerInfo
	mu        sync.RWMutex
	running   bool
	port      int
}

// NewServer creates a new preview server
func NewServer() *Server {
	return &Server{}
}

// Start starts the preview server and returns the URL
func (s *Server) Start(layer *LayerInfo) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// If already running, update layer and return existing URL
	if s.running {
		s.layer = layer
		return fmt.Sprintf("http://localhost:%d", s.port), nil
	}

	s.layer = layer

	// Find an available port
	listener, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		return "", fmt.Errorf("failed to find available port: %w", err)
	}
	s.listener = listener
	s.port = listener.Addr().(*net.TCPAddr).Port

	// Create file server for static files
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		listener.Close()
		return "", fmt.Errorf("failed to access static files: %w", err)
	}

	mux := http.NewServeMux()

	// Serve static files
	mux.Handle("/", http.FileServer(http.FS(staticFS)))

	// API endpoint to get layer info
	mux.HandleFunc("/api/layer", s.handleLayerInfo)

	// API endpoint to get extended metadata from GeoServer REST API
	mux.HandleFunc("/api/metadata", s.handleMetadata)

	s.server = &http.Server{
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	// Start server in goroutine
	go func() {
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			// Log error but don't crash
			fmt.Printf("Preview server error: %v\n", err)
		}
	}()

	s.running = true
	url := fmt.Sprintf("http://localhost:%d", s.port)
	return url, nil
}

// Stop stops the preview server
func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.server.Shutdown(ctx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
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

// GetPort returns the port the server is running on
func (s *Server) GetPort() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.port
}

// GetCurrentLayer returns the current layer info
func (s *Server) GetCurrentLayer() *LayerInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.layer
}

// GetLayerMetadata fetches and returns extended metadata for the current layer
func (s *Server) GetLayerMetadata() (*ExtendedMetadata, error) {
	s.mu.RLock()
	layer := s.layer
	s.mu.RUnlock()

	if layer == nil {
		return nil, fmt.Errorf("no layer configured")
	}

	metadata := &ExtendedMetadata{
		Errors: []string{},
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch store information
	s.fetchStoreMetadata(client, layer, metadata)

	// Fetch layer/featuretype/coverage information
	s.fetchLayerMetadata(client, layer, metadata)

	return metadata, nil
}

// handleLayerInfo returns the current layer info as JSON
func (s *Server) handleLayerInfo(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	layer := s.layer
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if layer == nil {
		http.Error(w, `{"error": "no layer configured"}`, http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(layer)
}

// ExtendedMetadata contains additional metadata from GeoServer REST API
type ExtendedMetadata struct {
	// Store info
	StoreDescription string `json:"store_description,omitempty"`
	StoreEnabled     bool   `json:"store_enabled"`
	StoreURL         string `json:"store_url,omitempty"` // File path on server
	StoreFormat      string `json:"store_format,omitempty"`

	// Layer info
	LayerTitle         string   `json:"layer_title,omitempty"`
	LayerAbstract      string   `json:"layer_abstract,omitempty"`
	LayerNativeCRS     string   `json:"layer_native_crs,omitempty"`
	LayerSRS           string   `json:"layer_srs,omitempty"`
	LayerNativeName    string   `json:"layer_native_name,omitempty"`
	LayerDefaultStyle  string   `json:"layer_default_style,omitempty"`
	LayerEnabled       bool     `json:"layer_enabled"`
	LayerQueryable     bool     `json:"layer_queryable"`
	LayerAdvertised    bool     `json:"layer_advertised"`
	LayerKeywords      []string `json:"layer_keywords,omitempty"`
	LayerMetadataLinks []string `json:"layer_metadata_links,omitempty"`

	// Feature type specific (vector)
	FeatureTypeName      string `json:"feature_type_name,omitempty"`
	FeatureTypeNativeCRS string `json:"feature_type_native_crs,omitempty"`
	FeatureTypeMaxFeatures int  `json:"feature_type_max_features,omitempty"`
	NumDecimals          int    `json:"num_decimals,omitempty"`

	// Coverage specific (raster)
	CoverageName         string   `json:"coverage_name,omitempty"`
	CoverageNativeFormat string   `json:"coverage_native_format,omitempty"`
	CoverageDimensions   []string `json:"coverage_dimensions,omitempty"`
	CoverageInterpolation string  `json:"coverage_interpolation,omitempty"`

	// Bounding boxes
	NativeBBox struct {
		MinX float64 `json:"minx"`
		MinY float64 `json:"miny"`
		MaxX float64 `json:"maxx"`
		MaxY float64 `json:"maxy"`
		CRS  string  `json:"crs,omitempty"`
	} `json:"native_bbox"`

	LatLonBBox struct {
		MinX float64 `json:"minx"`
		MinY float64 `json:"miny"`
		MaxX float64 `json:"maxx"`
		MaxY float64 `json:"maxy"`
	} `json:"latlon_bbox"`

	// Timestamps (if available)
	DateCreated  string `json:"date_created,omitempty"`
	DateModified string `json:"date_modified,omitempty"`

	// Errors during fetch
	Errors []string `json:"errors,omitempty"`
}

// handleMetadata fetches extended metadata from GeoServer REST API
func (s *Server) handleMetadata(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	layer := s.layer
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if layer == nil {
		http.Error(w, `{"error": "no layer configured"}`, http.StatusNotFound)
		return
	}

	metadata := &ExtendedMetadata{
		Errors: []string{},
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch store information
	s.fetchStoreMetadata(client, layer, metadata)

	// Fetch layer/featuretype/coverage information
	s.fetchLayerMetadata(client, layer, metadata)

	json.NewEncoder(w).Encode(metadata)
}

// fetchStoreMetadata fetches store information from GeoServer REST API
func (s *Server) fetchStoreMetadata(client *http.Client, layer *LayerInfo, metadata *ExtendedMetadata) {
	var storeURL string
	if layer.StoreType == "coveragestore" {
		storeURL = fmt.Sprintf("%s/rest/workspaces/%s/coveragestores/%s.json",
			layer.GeoServerURL, layer.Workspace, layer.StoreName)
	} else {
		storeURL = fmt.Sprintf("%s/rest/workspaces/%s/datastores/%s.json",
			layer.GeoServerURL, layer.Workspace, layer.StoreName)
	}

	req, err := http.NewRequest("GET", storeURL, nil)
	if err != nil {
		metadata.Errors = append(metadata.Errors, fmt.Sprintf("Failed to create store request: %v", err))
		return
	}

	if layer.Username != "" {
		req.SetBasicAuth(layer.Username, layer.Password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		metadata.Errors = append(metadata.Errors, fmt.Sprintf("Failed to fetch store info: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		metadata.Errors = append(metadata.Errors, fmt.Sprintf("Store API returned status %d", resp.StatusCode))
		return
	}

	body, _ := io.ReadAll(resp.Body)

	if layer.StoreType == "coveragestore" {
		var result struct {
			CoverageStore struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Enabled     bool   `json:"enabled"`
				Type        string `json:"type"`
				URL         string `json:"url"`
				DateCreated string `json:"dateCreated"`
				DateModified string `json:"dateModified"`
			} `json:"coverageStore"`
		}
		if err := json.Unmarshal(body, &result); err == nil {
			metadata.StoreDescription = result.CoverageStore.Description
			metadata.StoreEnabled = result.CoverageStore.Enabled
			metadata.StoreURL = result.CoverageStore.URL
			metadata.StoreFormat = result.CoverageStore.Type
			metadata.DateCreated = result.CoverageStore.DateCreated
			metadata.DateModified = result.CoverageStore.DateModified
		}
	} else {
		var result struct {
			DataStore struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Enabled     bool   `json:"enabled"`
				Type        string `json:"type"`
				DateCreated string `json:"dateCreated"`
				DateModified string `json:"dateModified"`
				ConnectionParameters struct {
					Entry []struct {
						Key   string `json:"@key"`
						Value string `json:"$"`
					} `json:"entry"`
				} `json:"connectionParameters"`
			} `json:"dataStore"`
		}
		if err := json.Unmarshal(body, &result); err == nil {
			metadata.StoreDescription = result.DataStore.Description
			metadata.StoreEnabled = result.DataStore.Enabled
			metadata.StoreFormat = result.DataStore.Type
			metadata.DateCreated = result.DataStore.DateCreated
			metadata.DateModified = result.DataStore.DateModified

			// Look for URL/file path in connection parameters
			for _, entry := range result.DataStore.ConnectionParameters.Entry {
				if entry.Key == "url" || entry.Key == "database" || entry.Key == "dbname" {
					metadata.StoreURL = entry.Value
					break
				}
			}
		}
	}
}

// fetchLayerMetadata fetches layer/featuretype/coverage information
func (s *Server) fetchLayerMetadata(client *http.Client, layer *LayerInfo, metadata *ExtendedMetadata) {
	// First, fetch the layer resource
	layerURL := fmt.Sprintf("%s/rest/layers/%s:%s.json",
		layer.GeoServerURL, layer.Workspace, layer.Name)

	req, err := http.NewRequest("GET", layerURL, nil)
	if err != nil {
		metadata.Errors = append(metadata.Errors, fmt.Sprintf("Failed to create layer request: %v", err))
		return
	}

	if layer.Username != "" {
		req.SetBasicAuth(layer.Username, layer.Password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		metadata.Errors = append(metadata.Errors, fmt.Sprintf("Failed to fetch layer info: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)

		var layerResult struct {
			Layer struct {
				Name         string `json:"name"`
				Type         string `json:"type"`
				Enabled      bool   `json:"enabled"`
				Queryable    bool   `json:"queryable"`
				Advertised   bool   `json:"advertised"`
				DefaultStyle struct {
					Name string `json:"name"`
				} `json:"defaultStyle"`
				Resource struct {
					Class string `json:"@class"`
					Name  string `json:"name"`
					Href  string `json:"href"`
				} `json:"resource"`
			} `json:"layer"`
		}

		if err := json.Unmarshal(body, &layerResult); err == nil {
			metadata.LayerEnabled = layerResult.Layer.Enabled
			metadata.LayerQueryable = layerResult.Layer.Queryable
			metadata.LayerAdvertised = layerResult.Layer.Advertised
			metadata.LayerDefaultStyle = layerResult.Layer.DefaultStyle.Name

			// Fetch the actual resource (featuretype or coverage)
			if layerResult.Layer.Resource.Href != "" {
				s.fetchResourceMetadata(client, layer, layerResult.Layer.Resource.Href, metadata)
			}
		}
	}

	// If layer fetch failed, try fetching featuretype/coverage directly
	if layer.Type == "vector" || layer.StoreType == "datastore" {
		s.fetchFeatureTypeMetadata(client, layer, metadata)
	} else {
		s.fetchCoverageMetadata(client, layer, metadata)
	}
}

// fetchResourceMetadata fetches the resource details from the href
func (s *Server) fetchResourceMetadata(client *http.Client, layer *LayerInfo, href string, metadata *ExtendedMetadata) {
	req, err := http.NewRequest("GET", href, nil)
	if err != nil {
		return
	}

	if layer.Username != "" {
		req.SetBasicAuth(layer.Username, layer.Password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	body, _ := io.ReadAll(resp.Body)
	s.parseResourceResponse(body, metadata)
}

// fetchFeatureTypeMetadata fetches feature type information
func (s *Server) fetchFeatureTypeMetadata(client *http.Client, layer *LayerInfo, metadata *ExtendedMetadata) {
	ftURL := fmt.Sprintf("%s/rest/workspaces/%s/datastores/%s/featuretypes/%s.json",
		layer.GeoServerURL, layer.Workspace, layer.StoreName, layer.Name)

	req, err := http.NewRequest("GET", ftURL, nil)
	if err != nil {
		return
	}

	if layer.Username != "" {
		req.SetBasicAuth(layer.Username, layer.Password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.parseResourceResponse(body, metadata)
	}
}

// fetchCoverageMetadata fetches coverage information
func (s *Server) fetchCoverageMetadata(client *http.Client, layer *LayerInfo, metadata *ExtendedMetadata) {
	covURL := fmt.Sprintf("%s/rest/workspaces/%s/coveragestores/%s/coverages/%s.json",
		layer.GeoServerURL, layer.Workspace, layer.StoreName, layer.Name)

	req, err := http.NewRequest("GET", covURL, nil)
	if err != nil {
		return
	}

	if layer.Username != "" {
		req.SetBasicAuth(layer.Username, layer.Password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.parseResourceResponse(body, metadata)
	}
}

// parseResourceResponse parses featuretype or coverage response
func (s *Server) parseResourceResponse(body []byte, metadata *ExtendedMetadata) {
	// Try featuretype first
	var ftResult struct {
		FeatureType struct {
			Name          string `json:"name"`
			NativeName    string `json:"nativeName"`
			Title         string `json:"title"`
			Abstract      string `json:"abstract"`
			NativeCRS     interface{} `json:"nativeCRS"` // Can be string or object
			SRS           string `json:"srs"`
			MaxFeatures   int    `json:"maxFeatures"`
			NumDecimals   int    `json:"numDecimals"`
			Keywords      struct {
				String []string `json:"string"`
			} `json:"keywords"`
			MetadataLinks struct {
				MetadataLink []struct {
					Content string `json:"content"`
				} `json:"metadataLink"`
			} `json:"metadataLinks"`
			NativeBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
				CRS  interface{} `json:"crs"`
			} `json:"nativeBoundingBox"`
			LatLonBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
			} `json:"latLonBoundingBox"`
		} `json:"featureType"`
	}

	if err := json.Unmarshal(body, &ftResult); err == nil && ftResult.FeatureType.Name != "" {
		ft := ftResult.FeatureType
		metadata.FeatureTypeName = ft.Name
		metadata.LayerNativeName = ft.NativeName
		metadata.LayerTitle = ft.Title
		metadata.LayerAbstract = ft.Abstract
		metadata.LayerSRS = ft.SRS
		metadata.FeatureTypeMaxFeatures = ft.MaxFeatures
		metadata.NumDecimals = ft.NumDecimals
		metadata.LayerKeywords = ft.Keywords.String

		// Handle nativeCRS which can be string or object
		switch v := ft.NativeCRS.(type) {
		case string:
			metadata.LayerNativeCRS = v
		case map[string]interface{}:
			if wkt, ok := v["$"].(string); ok {
				// Extract EPSG code if present
				metadata.LayerNativeCRS = wkt
			}
		}

		metadata.NativeBBox.MinX = ft.NativeBoundingBox.MinX
		metadata.NativeBBox.MinY = ft.NativeBoundingBox.MinY
		metadata.NativeBBox.MaxX = ft.NativeBoundingBox.MaxX
		metadata.NativeBBox.MaxY = ft.NativeBoundingBox.MaxY

		// Handle CRS in bbox
		switch v := ft.NativeBoundingBox.CRS.(type) {
		case string:
			metadata.NativeBBox.CRS = v
		case map[string]interface{}:
			if code, ok := v["$"].(string); ok {
				metadata.NativeBBox.CRS = code
			}
		}

		metadata.LatLonBBox.MinX = ft.LatLonBoundingBox.MinX
		metadata.LatLonBBox.MinY = ft.LatLonBoundingBox.MinY
		metadata.LatLonBBox.MaxX = ft.LatLonBoundingBox.MaxX
		metadata.LatLonBBox.MaxY = ft.LatLonBoundingBox.MaxY

		for _, ml := range ft.MetadataLinks.MetadataLink {
			metadata.LayerMetadataLinks = append(metadata.LayerMetadataLinks, ml.Content)
		}
		return
	}

	// Try coverage
	var covResult struct {
		Coverage struct {
			Name          string `json:"name"`
			NativeName    string `json:"nativeName"`
			Title         string `json:"title"`
			Abstract      string `json:"abstract"`
			NativeCRS     interface{} `json:"nativeCRS"`
			SRS           string `json:"srs"`
			NativeFormat  string `json:"nativeFormat"`
			Keywords      struct {
				String []string `json:"string"`
			} `json:"keywords"`
			Dimensions struct {
				CoverageDimension []struct {
					Name string `json:"name"`
				} `json:"coverageDimension"`
			} `json:"dimensions"`
			Interpolation string `json:"defaultInterpolationMethod"`
			NativeBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
				CRS  interface{} `json:"crs"`
			} `json:"nativeBoundingBox"`
			LatLonBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
			} `json:"latLonBoundingBox"`
		} `json:"coverage"`
	}

	if err := json.Unmarshal(body, &covResult); err == nil && covResult.Coverage.Name != "" {
		cov := covResult.Coverage
		metadata.CoverageName = cov.Name
		metadata.LayerNativeName = cov.NativeName
		metadata.LayerTitle = cov.Title
		metadata.LayerAbstract = cov.Abstract
		metadata.LayerSRS = cov.SRS
		metadata.CoverageNativeFormat = cov.NativeFormat
		metadata.CoverageInterpolation = cov.Interpolation
		metadata.LayerKeywords = cov.Keywords.String

		// Handle nativeCRS
		switch v := cov.NativeCRS.(type) {
		case string:
			metadata.LayerNativeCRS = v
		case map[string]interface{}:
			if wkt, ok := v["$"].(string); ok {
				metadata.LayerNativeCRS = wkt
			}
		}

		// Extract dimension names
		for _, dim := range cov.Dimensions.CoverageDimension {
			metadata.CoverageDimensions = append(metadata.CoverageDimensions, dim.Name)
		}

		metadata.NativeBBox.MinX = cov.NativeBoundingBox.MinX
		metadata.NativeBBox.MinY = cov.NativeBoundingBox.MinY
		metadata.NativeBBox.MaxX = cov.NativeBoundingBox.MaxX
		metadata.NativeBBox.MaxY = cov.NativeBoundingBox.MaxY

		switch v := cov.NativeBoundingBox.CRS.(type) {
		case string:
			metadata.NativeBBox.CRS = v
		case map[string]interface{}:
			if code, ok := v["$"].(string); ok {
				metadata.NativeBBox.CRS = code
			}
		}

		metadata.LatLonBBox.MinX = cov.LatLonBoundingBox.MinX
		metadata.LatLonBBox.MinY = cov.LatLonBoundingBox.MinY
		metadata.LatLonBBox.MaxX = cov.LatLonBoundingBox.MaxX
		metadata.LatLonBBox.MaxY = cov.LatLonBoundingBox.MaxY
	}
}

// OpenBrowser opens the default browser with the given URL
func OpenBrowser(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}

	return exec.Command(cmd, args...).Start()
}
