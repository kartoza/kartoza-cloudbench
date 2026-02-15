package webserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kartoza/kartoza-cloudbench/internal/api"
	"github.com/kartoza/kartoza-cloudbench/internal/integration"
	"github.com/kartoza/kartoza-cloudbench/internal/query"
)

// handleSQLView handles /api/sqlview/* routes
func (s *Server) handleSQLView(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/sqlview")
	path = strings.Trim(path, "/")

	parts := strings.Split(path, "/")

	switch {
	case path == "" && r.Method == http.MethodPost:
		// POST /api/sqlview - Create SQL View layer
		s.handleCreateSQLView(w, r)

	case path == "datastores" && r.Method == http.MethodGet:
		// GET /api/sqlview/datastores?connection={connId}&workspace={ws}
		s.handleListPostGISDataStores(w, r)

	case path == "detect" && r.Method == http.MethodPost:
		// POST /api/sqlview/detect - Detect geometry from SQL
		s.handleDetectGeometry(w, r)

	case len(parts) >= 3 && r.Method == http.MethodPut:
		// PUT /api/sqlview/{connId}/{workspace}/{layerName} - Update
		s.handleUpdateSQLView(w, r, parts[0], parts[1], parts[2])

	case len(parts) >= 3 && r.Method == http.MethodDelete:
		// DELETE /api/sqlview/{connId}/{workspace}/{layerName}
		s.handleDeleteSQLView(w, r, parts[0], parts[1], parts[2])

	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

// handleCreateSQLView creates a new SQL View layer
func (s *Server) handleCreateSQLView(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectionID    string                  `json:"connection_id"`
		Workspace       string                  `json:"workspace"`
		DataStore       string                  `json:"datastore"`
		LayerName       string                  `json:"layer_name"`
		Title           string                  `json:"title"`
		Abstract        string                  `json:"abstract"`
		SQL             string                  `json:"sql,omitempty"`
		QueryDefinition *query.QueryDefinition `json:"query_definition,omitempty"`
		GeometryColumn  string                  `json:"geometry_column"`
		GeometryType    string                  `json:"geometry_type"`
		SRID            int                     `json:"srid"`
		KeyColumn       string                  `json:"key_column,omitempty"`
		Parameters      []api.SQLViewParameter  `json:"parameters,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.ConnectionID == "" || req.Workspace == "" || req.DataStore == "" || req.LayerName == "" {
		s.jsonError(w, "connection_id, workspace, datastore, and layer_name are required", http.StatusBadRequest)
		return
	}

	if req.SQL == "" && req.QueryDefinition == nil {
		s.jsonError(w, "Either sql or query_definition must be provided", http.StatusBadRequest)
		return
	}

	// Get the GeoServer client
	client := s.getClient(req.ConnectionID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	// Build configuration
	config := integration.SQLViewLayerConfig{
		GeoServerConnectionID: req.ConnectionID,
		Workspace:             req.Workspace,
		DataStore:             req.DataStore,
		LayerName:             req.LayerName,
		Title:                 req.Title,
		Abstract:              req.Abstract,
		SQL:                   req.SQL,
		QueryDefinition:       req.QueryDefinition,
		GeometryColumn:        req.GeometryColumn,
		GeometryType:          req.GeometryType,
		SRID:                  req.SRID,
		KeyColumn:             req.KeyColumn,
		Parameters:            req.Parameters,
	}

	// Create the SQL View layer
	result, err := integration.CreateSQLViewLayer(client, config)
	if err != nil {
		s.jsonError(w, result.Error, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(result)
}

// handleUpdateSQLView updates an existing SQL View layer
func (s *Server) handleUpdateSQLView(w http.ResponseWriter, r *http.Request, connID, workspace, layerName string) {
	var req struct {
		DataStore       string                  `json:"datastore"`
		Title           string                  `json:"title"`
		Abstract        string                  `json:"abstract"`
		SQL             string                  `json:"sql,omitempty"`
		QueryDefinition *query.QueryDefinition `json:"query_definition,omitempty"`
		GeometryColumn  string                  `json:"geometry_column"`
		GeometryType    string                  `json:"geometry_type"`
		SRID            int                     `json:"srid"`
		KeyColumn       string                  `json:"key_column,omitempty"`
		Parameters      []api.SQLViewParameter  `json:"parameters,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.DataStore == "" {
		s.jsonError(w, "datastore is required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	config := integration.SQLViewLayerConfig{
		GeoServerConnectionID: connID,
		Workspace:             workspace,
		DataStore:             req.DataStore,
		LayerName:             layerName,
		Title:                 req.Title,
		Abstract:              req.Abstract,
		SQL:                   req.SQL,
		QueryDefinition:       req.QueryDefinition,
		GeometryColumn:        req.GeometryColumn,
		GeometryType:          req.GeometryType,
		SRID:                  req.SRID,
		KeyColumn:             req.KeyColumn,
		Parameters:            req.Parameters,
	}

	result, err := integration.UpdateSQLViewLayer(client, config)
	if err != nil {
		s.jsonError(w, result.Error, http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, result)
}

// handleDeleteSQLView deletes a SQL View layer
func (s *Server) handleDeleteSQLView(w http.ResponseWriter, r *http.Request, connID, workspace, layerName string) {
	dataStore := r.URL.Query().Get("datastore")
	if dataStore == "" {
		s.jsonError(w, "datastore query parameter is required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if err := integration.DeleteSQLViewLayer(client, workspace, dataStore, layerName); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleListPostGISDataStores returns PostGIS data stores available in a workspace
func (s *Server) handleListPostGISDataStores(w http.ResponseWriter, r *http.Request) {
	connID := r.URL.Query().Get("connection")
	workspace := r.URL.Query().Get("workspace")

	if connID == "" || workspace == "" {
		s.jsonError(w, "connection and workspace query parameters are required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	stores, err := integration.ListPostGISDataStores(client, workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, map[string]interface{}{
		"datastores": stores,
	})
}

// handleDetectGeometry attempts to detect geometry column info from a SQL query
func (s *Server) handleDetectGeometry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PGServiceName string `json:"pg_service_name"`
		SQL           string `json:"sql"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.PGServiceName == "" || req.SQL == "" {
		s.jsonError(w, "pg_service_name and sql are required", http.StatusBadRequest)
		return
	}

	column, geomType, srid, err := integration.DetectGeometryColumn(req.PGServiceName, req.SQL)
	if err != nil {
		// Return defaults even on error
		s.jsonResponse(w, map[string]interface{}{
			"geometry_column": "geom",
			"geometry_type":   "Geometry",
			"srid":            4326,
			"detected":        false,
			"error":           err.Error(),
		})
		return
	}

	s.jsonResponse(w, map[string]interface{}{
		"geometry_column": column,
		"geometry_type":   geomType,
		"srid":            srid,
		"detected":        true,
	})
}
