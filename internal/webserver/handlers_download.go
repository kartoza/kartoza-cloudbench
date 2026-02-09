package webserver

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/kartoza/kartoza-geoserver-client/internal/cache"
	"github.com/kartoza/kartoza-geoserver-client/internal/sync"
)

// handleDownload handles resource download requests
// Routes:
//   GET /api/download/{connId}/workspace/{workspace}
//   GET /api/download/{connId}/datastore/{workspace}/{store}
//   GET /api/download/{connId}/coveragestore/{workspace}/{store}
//   GET /api/download/{connId}/layer/{workspace}/{layer}
//   GET /api/download/{connId}/style/{workspace}/{style}
//   GET /api/download/{connId}/layergroup/{workspace}/{group}
//   GET /api/download/{connId}/shapefile/{workspace}/{layer} - download layer as shapefile
//   GET /api/download/{connId}/geotiff/{workspace}/{coverage} - download coverage as GeoTIFF
func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse path: /api/download/{connId}/{resourceType}/{workspace}/[name]
	path := strings.TrimPrefix(r.URL.Path, "/api/download/")
	path = strings.TrimSuffix(path, "/")
	parts := strings.Split(path, "/")

	if len(parts) < 3 {
		s.jsonError(w, "Invalid download path", http.StatusBadRequest)
		return
	}

	connID := parts[0]
	resourceType := parts[1]
	workspace := parts[2]
	var name string
	if len(parts) >= 4 {
		name = parts[3]
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	var data []byte
	var filename string
	var contentType string
	var err error

	switch resourceType {
	case "workspace":
		data, err = client.DownloadWorkspace(workspace)
		filename = fmt.Sprintf("%s_workspace.json", workspace)
		contentType = "application/json"

	case "datastore":
		if name == "" {
			s.jsonError(w, "Store name required", http.StatusBadRequest)
			return
		}
		data, err = client.DownloadDataStore(workspace, name)
		filename = fmt.Sprintf("%s_%s_datastore.json", workspace, name)
		contentType = "application/json"

	case "coveragestore":
		if name == "" {
			s.jsonError(w, "Store name required", http.StatusBadRequest)
			return
		}
		data, err = client.DownloadCoverageStore(workspace, name)
		filename = fmt.Sprintf("%s_%s_coveragestore.json", workspace, name)
		contentType = "application/json"

	case "layer":
		if name == "" {
			s.jsonError(w, "Layer name required", http.StatusBadRequest)
			return
		}
		data, err = client.DownloadLayer(workspace, name)
		filename = fmt.Sprintf("%s_%s_layer.json", workspace, name)
		contentType = "application/json"

	case "style":
		if name == "" {
			s.jsonError(w, "Style name required", http.StatusBadRequest)
			return
		}
		var ext string
		data, ext, err = client.DownloadStyle(workspace, name)
		filename = fmt.Sprintf("%s_%s%s", workspace, name, ext)
		if ext == ".css" {
			contentType = "text/css"
		} else if ext == ".json" {
			contentType = "application/json"
		} else {
			contentType = "application/xml"
		}

	case "layergroup":
		if name == "" {
			s.jsonError(w, "Layer group name required", http.StatusBadRequest)
			return
		}
		data, err = client.DownloadLayerGroup(workspace, name)
		filename = fmt.Sprintf("%s_%s_layergroup.json", workspace, name)
		contentType = "application/json"

	case "shapefile":
		// Download layer data as shapefile (via WFS)
		if name == "" {
			s.jsonError(w, "Layer name required", http.StatusBadRequest)
			return
		}
		// Check cache first
		if cache.DefaultManager != nil {
			entry, _ := cache.DefaultManager.GetCacheEntry(connID, workspace, cache.ResourceTypeFeatureType, "", name)
			if entry != nil && entry.DataFile != "" {
				cachedData, cacheErr := cache.DefaultManager.ReadCachedData(entry)
				if cacheErr == nil {
					data = cachedData
					filename = fmt.Sprintf("%s_%s.shp.zip", workspace, name)
					contentType = "application/zip"
					break
				}
			}
		}
		// Not in cache, download from server
		data, err = client.DownloadLayerAsShapefile(workspace, name)
		if err == nil && cache.DefaultManager != nil {
			// Cache the downloaded data for future use
			go func() {
				cache.DefaultManager.CacheFeatureType(client, connID, workspace, "", name)
			}()
		}
		filename = fmt.Sprintf("%s_%s.shp.zip", workspace, name)
		contentType = "application/zip"

	case "geotiff":
		// Download coverage data as GeoTIFF (via WCS)
		if name == "" {
			s.jsonError(w, "Coverage name required", http.StatusBadRequest)
			return
		}
		// Check cache first
		if cache.DefaultManager != nil {
			entry, _ := cache.DefaultManager.GetCacheEntry(connID, workspace, cache.ResourceTypeCoverage, "", name)
			if entry != nil && entry.DataFile != "" {
				cachedData, cacheErr := cache.DefaultManager.ReadCachedData(entry)
				if cacheErr == nil {
					data = cachedData
					filename = fmt.Sprintf("%s_%s.tif", workspace, name)
					contentType = "image/tiff"
					break
				}
			}
		}
		// Not in cache, download from server
		data, err = client.DownloadCoverageAsGeoTIFF(workspace, name)
		if err == nil && cache.DefaultManager != nil {
			// Cache the downloaded data for future use
			go func() {
				cache.DefaultManager.CacheCoverage(client, connID, workspace, "", name)
			}()
		}
		filename = fmt.Sprintf("%s_%s.tif", workspace, name)
		contentType = "image/tiff"

	default:
		s.jsonError(w, "Unknown resource type", http.StatusBadRequest)
		return
	}

	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Set headers for file download
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Write(data)
}

// handleDownloadLogs handles sync log download requests
// Route: GET /api/download/logs/{taskId}
func (s *Server) handleDownloadLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse task ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/download/logs/")
	taskID := strings.TrimSuffix(path, "/")

	if taskID == "" {
		s.jsonError(w, "Task ID required", http.StatusBadRequest)
		return
	}

	// Get task logs from sync manager
	task := sync.DefaultManager.GetTask(taskID)
	if task == nil {
		s.jsonError(w, "Task not found", http.StatusNotFound)
		return
	}

	// Build log content
	logs := task.GetLogs()
	content := strings.Join(logs, "\n")

	// Set headers for file download
	filename := fmt.Sprintf("sync_log_%s.txt", taskID)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
	w.Write([]byte(content))
}
