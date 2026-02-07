package webserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/preview"
)

// UploadResponse represents the response from a file upload
type UploadResponse struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	StoreName string `json:"storeName,omitempty"`
	StoreType string `json:"storeType,omitempty"`
}

// handleUpload handles file upload requests
// POST /api/upload?connId={connId}&workspace={workspace}
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if r.Method != http.MethodPost {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse query parameters
	connID := r.URL.Query().Get("connId")
	workspace := r.URL.Query().Get("workspace")

	if connID == "" || workspace == "" {
		s.jsonError(w, "Connection ID and workspace are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	// Parse multipart form (32MB max)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		s.jsonError(w, "Failed to parse multipart form", http.StatusBadRequest)
		return
	}

	// Get uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		s.jsonError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Determine file type
	filename := header.Filename
	fileType := detectFileType(filename)

	if !fileType.CanUpload() {
		s.jsonError(w, "Unsupported file type", http.StatusBadRequest)
		return
	}

	// Create temporary file
	tempDir := os.TempDir()
	tempFile, err := os.CreateTemp(tempDir, "upload-*-"+filename)
	if err != nil {
		s.jsonError(w, "Failed to create temporary file", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Copy uploaded file to temp file
	if _, err := io.Copy(tempFile, file); err != nil {
		s.jsonError(w, "Failed to save uploaded file", http.StatusInternalServerError)
		return
	}
	tempFile.Close()

	// Derive store name from filename (without extension)
	storeName := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Upload based on file type
	var uploadErr error
	var storeType string

	switch fileType {
	case models.FileTypeShapefile:
		uploadErr = client.UploadShapefile(workspace, storeName, tempFile.Name())
		storeType = "datastore"
	case models.FileTypeGeoTIFF:
		uploadErr = client.UploadGeoTIFF(workspace, storeName, tempFile.Name())
		storeType = "coveragestore"
	case models.FileTypeGeoPackage:
		uploadErr = client.UploadGeoPackage(workspace, storeName, tempFile.Name())
		storeType = "datastore"
	case models.FileTypeSLD, models.FileTypeCSS:
		format := "sld"
		if fileType == models.FileTypeCSS {
			format = "css"
		}
		uploadErr = client.UploadStyle(workspace, storeName, tempFile.Name(), format)
		storeType = "style"
	default:
		s.jsonError(w, "Unsupported file type for upload", http.StatusBadRequest)
		return
	}

	if uploadErr != nil {
		s.jsonResponse(w, UploadResponse{
			Success: false,
			Message: uploadErr.Error(),
		})
		return
	}

	s.jsonResponse(w, UploadResponse{
		Success:   true,
		Message:   fmt.Sprintf("Successfully uploaded %s", filename),
		StoreName: storeName,
		StoreType: storeType,
	})
}

// detectFileType detects the file type based on extension
func detectFileType(filename string) models.FileType {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".shp", ".zip":
		return models.FileTypeShapefile
	case ".gpkg":
		return models.FileTypeGeoPackage
	case ".tif", ".tiff":
		return models.FileTypeGeoTIFF
	case ".geojson", ".json":
		return models.FileTypeGeoJSON
	case ".sld":
		return models.FileTypeSLD
	case ".css":
		return models.FileTypeCSS
	default:
		return models.FileTypeOther
	}
}

// PreviewRequest represents a preview start request
type PreviewRequest struct {
	ConnID    string `json:"connId"`
	Workspace string `json:"workspace"`
	LayerName string `json:"layerName"`
	StoreName string `json:"storeName,omitempty"`
	StoreType string `json:"storeType,omitempty"`
	LayerType string `json:"layerType,omitempty"`
}

// handlePreview handles preview requests
// POST /api/preview - starts a layer preview
func (s *Server) handlePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if r.Method != http.MethodPost {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ConnID == "" || req.Workspace == "" || req.LayerName == "" {
		s.jsonError(w, "Connection ID, workspace, and layer name are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(req.ConnID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	conn := s.getConnectionConfig(req.ConnID)
	if conn == nil {
		s.jsonError(w, "Connection configuration not found", http.StatusNotFound)
		return
	}

	// Determine layer type if not provided
	layerType := req.LayerType
	if layerType == "" {
		if req.StoreType == "coveragestore" {
			layerType = "raster"
		} else {
			layerType = "vector"
		}
	}

	// Create layer info for preview
	layerInfo := &preview.LayerInfo{
		Name:         req.LayerName,
		Workspace:    req.Workspace,
		StoreName:    req.StoreName,
		StoreType:    req.StoreType,
		GeoServerURL: client.BaseURL(),
		Type:         layerType,
		Username:     conn.Username,
		Password:     conn.Password,
	}

	// Start or update preview server
	if s.previewServer == nil {
		s.previewServer = preview.NewServer()
	}

	// Start preview returns the URL
	url, err := s.previewServer.Start(layerInfo)
	if err != nil {
		s.jsonError(w, fmt.Sprintf("Failed to start preview: %v", err), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, map[string]string{
		"url": url,
	})
}

// handleLayerInfo handles layer info requests for the preview server
// GET /api/layer - returns current layer configuration
func (s *Server) handleLayerInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if s.previewServer == nil {
		s.jsonError(w, "No preview active", http.StatusNotFound)
		return
	}

	layerInfo := s.previewServer.GetCurrentLayer()
	if layerInfo == nil {
		s.jsonError(w, "No layer configured", http.StatusNotFound)
		return
	}

	s.jsonResponse(w, layerInfo)
}

// handleMetadata handles metadata requests for the preview server
// GET /api/metadata - returns layer metadata including bounding box
func (s *Server) handleMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if s.previewServer == nil {
		s.jsonError(w, "No preview active", http.StatusNotFound)
		return
	}

	metadata, err := s.previewServer.GetLayerMetadata()
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, metadata)
}
