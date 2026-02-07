package webserver

import (
	"encoding/json"
	"net/http"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// LayerResponse represents a layer in API responses
type LayerResponse struct {
	Name         string `json:"name"`
	Workspace    string `json:"workspace"`
	Store        string `json:"store,omitempty"`
	StoreType    string `json:"storeType,omitempty"`
	Type         string `json:"type,omitempty"`
	Enabled      bool   `json:"enabled"`
	Advertised   bool   `json:"advertised"`
	Queryable    bool   `json:"queryable"`
	DefaultStyle string `json:"defaultStyle,omitempty"`
}

// LayerUpdateRequest represents a layer update request
type LayerUpdateRequest struct {
	Enabled    bool `json:"enabled"`
	Advertised bool `json:"advertised"`
	Queryable  bool `json:"queryable"`
}

// handleLayers handles layer related requests
// Pattern: /api/layers/{connId}/{workspace} or /api/layers/{connId}/{workspace}/{layer}
func (s *Server) handleLayers(w http.ResponseWriter, r *http.Request) {
	connID, workspace, layer := parsePathParams(r.URL.Path, "/api/layers")

	if connID == "" || workspace == "" {
		s.jsonError(w, "Connection ID and workspace are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if layer == "" {
		// Operating on layer collection
		switch r.Method {
		case http.MethodGet:
			s.listLayers(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific layer
		switch r.Method {
		case http.MethodGet:
			s.getLayer(w, r, client, workspace, layer)
		case http.MethodPut:
			s.updateLayer(w, r, client, workspace, layer)
		case http.MethodDelete:
			s.deleteLayer(w, r, client, workspace, layer)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// listLayers returns all layers for a workspace
func (s *Server) listLayers(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	layers, err := client.GetLayers(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]LayerResponse, len(layers))
	for i, layer := range layers {
		enabled := true
		if layer.Enabled != nil {
			enabled = *layer.Enabled
		}
		response[i] = LayerResponse{
			Name:      layer.Name,
			Workspace: workspace,
			Type:      layer.Type,
			Enabled:   enabled,
		}
	}
	s.jsonResponse(w, response)
}

// getLayer returns a specific layer
func (s *Server) getLayer(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, layer string) {
	config, err := client.GetLayerConfig(workspace, layer)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	s.jsonResponse(w, LayerResponse{
		Name:         config.Name,
		Workspace:    config.Workspace,
		Store:        config.Store,
		StoreType:    config.StoreType,
		Enabled:      config.Enabled,
		Advertised:   config.Advertised,
		Queryable:    config.Queryable,
		DefaultStyle: config.DefaultStyle,
	})
}

// updateLayer updates a layer
func (s *Server) updateLayer(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, layer string) {
	var req LayerUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get current layer config to preserve store info
	currentConfig, err := client.GetLayerConfig(workspace, layer)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	config := models.LayerConfig{
		Name:       layer,
		Workspace:  workspace,
		Store:      currentConfig.Store,
		StoreType:  currentConfig.StoreType,
		Enabled:    req.Enabled,
		Advertised: req.Advertised,
		Queryable:  req.Queryable,
	}

	if err := client.UpdateLayerConfig(workspace, config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, LayerResponse{
		Name:       config.Name,
		Workspace:  workspace,
		Store:      config.Store,
		StoreType:  config.StoreType,
		Enabled:    config.Enabled,
		Advertised: config.Advertised,
		Queryable:  config.Queryable,
	})
}

// deleteLayer deletes a layer
func (s *Server) deleteLayer(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, layer string) {
	if err := client.DeleteLayer(workspace, layer); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleFeatureTypes handles feature type related requests
// Pattern: /api/featuretypes/{connId}/{workspace}/{store}
func (s *Server) handleFeatureTypes(w http.ResponseWriter, r *http.Request) {
	connID, workspace, store, _ := parseStorePathParams(r.URL.Path, "/api/featuretypes")

	if connID == "" || workspace == "" || store == "" {
		s.jsonError(w, "Connection ID, workspace, and store are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.listFeatureTypes(w, r, client, workspace, store)
	case http.MethodPost:
		s.publishFeatureType(w, r, client, workspace, store)
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listFeatureTypes returns all feature types for a data store
func (s *Server) listFeatureTypes(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	featureTypes, err := client.GetFeatureTypes(workspace, store)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]map[string]string, len(featureTypes))
	for i, ft := range featureTypes {
		response[i] = map[string]string{
			"name":      ft.Name,
			"workspace": workspace,
			"store":     store,
		}
	}
	s.jsonResponse(w, response)
}

// publishFeatureType publishes a new feature type
func (s *Server) publishFeatureType(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Feature type name is required", http.StatusBadRequest)
		return
	}

	if err := client.PublishFeatureType(workspace, store, req.Name); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, map[string]string{
		"name":      req.Name,
		"workspace": workspace,
		"store":     store,
	})
}

// handleCoverages handles coverage related requests
// Pattern: /api/coverages/{connId}/{workspace}/{store}
func (s *Server) handleCoverages(w http.ResponseWriter, r *http.Request) {
	connID, workspace, store, _ := parseStorePathParams(r.URL.Path, "/api/coverages")

	if connID == "" || workspace == "" || store == "" {
		s.jsonError(w, "Connection ID, workspace, and store are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.listCoverages(w, r, client, workspace, store)
	case http.MethodPost:
		s.publishCoverage(w, r, client, workspace, store)
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listCoverages returns all coverages for a coverage store
func (s *Server) listCoverages(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	coverages, err := client.GetCoverages(workspace, store)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]map[string]string, len(coverages))
	for i, cov := range coverages {
		response[i] = map[string]string{
			"name":      cov.Name,
			"workspace": workspace,
			"store":     store,
		}
	}
	s.jsonResponse(w, response)
}

// publishCoverage publishes a new coverage
func (s *Server) publishCoverage(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, store string) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Coverage name is required", http.StatusBadRequest)
		return
	}

	if err := client.PublishCoverage(workspace, store, req.Name); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, map[string]string{
		"name":      req.Name,
		"workspace": workspace,
		"store":     store,
	})
}
