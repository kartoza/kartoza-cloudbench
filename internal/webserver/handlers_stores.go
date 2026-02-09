package webserver

import (
	"encoding/json"
	"net/http"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// DataStoreResponse represents a data store in API responses
type DataStoreResponse struct {
	Name      string `json:"name"`
	Type      string `json:"type,omitempty"`
	Enabled   bool   `json:"enabled"`
	Workspace string `json:"workspace"`
}

// DataStoreCreateRequest represents a data store create request
type DataStoreCreateRequest struct {
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Parameters map[string]string `json:"parameters"`
}

// CoverageStoreResponse represents a coverage store in API responses
type CoverageStoreResponse struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"`
	Enabled     bool   `json:"enabled"`
	Workspace   string `json:"workspace"`
	Description string `json:"description,omitempty"`
}

// CoverageStoreCreateRequest represents a coverage store create request
type CoverageStoreCreateRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
	URL  string `json:"url"`
}

// handleDataStores handles data store related requests
// Pattern: /api/datastores/{connId}/{workspace} or /api/datastores/{connId}/{workspace}/{store}
// Also handles: /api/datastores/{connId}/{workspace}/{store}/available
//               /api/datastores/{connId}/{workspace}/{store}/publish
func (s *Server) handleDataStores(w http.ResponseWriter, r *http.Request) {
	connID, workspace, store, action := parseStorePathParams(r.URL.Path, "/api/datastores")

	if connID == "" || workspace == "" {
		s.jsonError(w, "Connection ID and workspace are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	// Handle special actions on stores
	if store != "" && action != "" {
		switch action {
		case "available":
			s.handleStoreAvailableFeatureTypes(w, r, client, workspace, store)
			return
		case "publish":
			s.handleStorePublishFeatureTypes(w, r, client, workspace, store)
			return
		}
	}

	if store == "" {
		// Operating on store collection
		switch r.Method {
		case http.MethodGet:
			s.listDataStores(w, r, client, workspace)
		case http.MethodPost:
			s.createDataStore(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific store
		switch r.Method {
		case http.MethodGet:
			s.getDataStore(w, r, client, workspace, store)
		case http.MethodPut:
			s.updateDataStore(w, r, client, workspace, store)
		case http.MethodDelete:
			s.deleteDataStore(w, r, client, workspace, store)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// PublishFeatureTypeRequest represents a request to publish feature types
type PublishFeatureTypeRequest struct {
	FeatureTypes []string `json:"featureTypes"`
}

// handleStoreAvailableFeatureTypes returns unpublished feature types for a store
func (s *Server) handleStoreAvailableFeatureTypes(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if r.Method != http.MethodGet {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	available, err := client.GetAvailableFeatureTypes(workspace, store)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.jsonResponse(w, map[string][]string{"available": available})
}

// handleStorePublishFeatureTypes publishes feature types from a store
func (s *Server) handleStorePublishFeatureTypes(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	if r.Method == http.MethodOptions {
		s.handleCORS(w)
		return
	}

	if r.Method != http.MethodPost {
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PublishFeatureTypeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.FeatureTypes) == 0 {
		s.jsonError(w, "At least one feature type is required", http.StatusBadRequest)
		return
	}

	// Publish each feature type
	var published []string
	var errors []string

	for _, ft := range req.FeatureTypes {
		if err := client.PublishFeatureType(workspace, store, ft); err != nil {
			errors = append(errors, ft+": "+err.Error())
		} else {
			published = append(published, ft)
		}
	}

	s.jsonResponse(w, map[string]interface{}{
		"published": published,
		"errors":    errors,
	})
}

// listDataStores returns all data stores for a workspace
func (s *Server) listDataStores(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	stores, err := client.GetDataStores(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]DataStoreResponse, len(stores))
	for i, store := range stores {
		response[i] = DataStoreResponse{
			Name:      store.Name,
			Type:      store.Type,
			Enabled:   store.Enabled,
			Workspace: workspace,
		}
	}
	s.jsonResponse(w, response)
}

// getDataStore returns a specific data store
func (s *Server) getDataStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	config, err := client.GetDataStoreConfig(workspace, store)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	s.jsonResponse(w, DataStoreResponse{
		Name:      config.Name,
		Enabled:   config.Enabled,
		Workspace: workspace,
	})
}

// createDataStore creates a new data store
func (s *Server) createDataStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	var req DataStoreCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Store name is required", http.StatusBadRequest)
		return
	}

	// Map type string to DataStoreType
	var storeType models.DataStoreType
	switch req.Type {
	case "postgis":
		storeType = models.DataStoreTypePostGIS
	case "shapefile":
		storeType = models.DataStoreTypeShapefileDir
	case "geopackage":
		storeType = models.DataStoreTypeGeoPackage
	case "wfs":
		storeType = models.DataStoreTypeWFS
	default:
		storeType = models.DataStoreTypePostGIS
	}

	if err := client.CreateDataStore(workspace, req.Name, storeType, req.Parameters); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, DataStoreResponse{
		Name:      req.Name,
		Type:      req.Type,
		Workspace: workspace,
	})
}

// updateDataStore updates a data store
func (s *Server) updateDataStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	var req struct {
		Name        string `json:"name"`
		Enabled     bool   `json:"enabled"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	config := models.DataStoreConfig{
		Name:        req.Name,
		Workspace:   workspace,
		Enabled:     req.Enabled,
		Description: req.Description,
	}

	if err := client.UpdateDataStoreConfig(workspace, config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, DataStoreResponse{
		Name:      config.Name,
		Enabled:   config.Enabled,
		Workspace: workspace,
	})
}

// deleteDataStore deletes a data store
func (s *Server) deleteDataStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	recurse := r.URL.Query().Get("recurse") == "true"

	if err := client.DeleteDataStore(workspace, store, recurse); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleCoverageStores handles coverage store related requests
// Pattern: /api/coveragestores/{connId}/{workspace} or /api/coveragestores/{connId}/{workspace}/{store}
func (s *Server) handleCoverageStores(w http.ResponseWriter, r *http.Request) {
	connID, workspace, store := parsePathParams(r.URL.Path, "/api/coveragestores")

	if connID == "" || workspace == "" {
		s.jsonError(w, "Connection ID and workspace are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if store == "" {
		// Operating on store collection
		switch r.Method {
		case http.MethodGet:
			s.listCoverageStores(w, r, client, workspace)
		case http.MethodPost:
			s.createCoverageStore(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific store
		switch r.Method {
		case http.MethodGet:
			s.getCoverageStore(w, r, client, workspace, store)
		case http.MethodPut:
			s.updateCoverageStore(w, r, client, workspace, store)
		case http.MethodDelete:
			s.deleteCoverageStore(w, r, client, workspace, store)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// listCoverageStores returns all coverage stores for a workspace
func (s *Server) listCoverageStores(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	stores, err := client.GetCoverageStores(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]CoverageStoreResponse, len(stores))
	for i, store := range stores {
		response[i] = CoverageStoreResponse{
			Name:        store.Name,
			Type:        store.Type,
			Enabled:     store.Enabled,
			Workspace:   workspace,
			Description: store.Description,
		}
	}
	s.jsonResponse(w, response)
}

// getCoverageStore returns a specific coverage store
func (s *Server) getCoverageStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	config, err := client.GetCoverageStoreConfig(workspace, store)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	s.jsonResponse(w, CoverageStoreResponse{
		Name:        config.Name,
		Enabled:     config.Enabled,
		Workspace:   workspace,
		Description: config.Description,
	})
}

// createCoverageStore creates a new coverage store
func (s *Server) createCoverageStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	var req CoverageStoreCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.URL == "" {
		s.jsonError(w, "Store name and URL are required", http.StatusBadRequest)
		return
	}

	// Map type string to CoverageStoreType
	var storeType models.CoverageStoreType
	switch req.Type {
	case "geotiff":
		storeType = models.CoverageStoreTypeGeoTIFF
	case "worldimage":
		storeType = models.CoverageStoreTypeWorldImage
	case "imagemosaic":
		storeType = models.CoverageStoreTypeImageMosaic
	case "imagepyramid":
		storeType = models.CoverageStoreTypeImagePyramid
	case "arcgrid":
		storeType = models.CoverageStoreTypeArcGrid
	case "geopackage":
		storeType = models.CoverageStoreTypeGeoPackageRaster
	default:
		storeType = models.CoverageStoreTypeGeoTIFF
	}

	if err := client.CreateCoverageStore(workspace, req.Name, storeType, req.URL); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, CoverageStoreResponse{
		Name:      req.Name,
		Type:      req.Type,
		Workspace: workspace,
	})
}

// updateCoverageStore updates a coverage store
func (s *Server) updateCoverageStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	var req struct {
		Name        string `json:"name"`
		Enabled     bool   `json:"enabled"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	config := models.CoverageStoreConfig{
		Name:        req.Name,
		Workspace:   workspace,
		Enabled:     req.Enabled,
		Description: req.Description,
	}

	if err := client.UpdateCoverageStoreConfig(workspace, config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, CoverageStoreResponse{
		Name:        config.Name,
		Enabled:     config.Enabled,
		Workspace:   workspace,
		Description: config.Description,
	})
}

// deleteCoverageStore deletes a coverage store
func (s *Server) deleteCoverageStore(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	recurse := r.URL.Query().Get("recurse") == "true"

	if err := client.DeleteCoverageStore(workspace, store, recurse); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
