package webserver

import (
	"encoding/json"
	"net/http"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// WorkspaceResponse represents a workspace in API responses
type WorkspaceResponse struct {
	Name     string `json:"name"`
	Href     string `json:"href,omitempty"`
	Isolated bool   `json:"isolated,omitempty"`
}

// WorkspaceConfigResponse represents workspace configuration in API responses
type WorkspaceConfigResponse struct {
	Name        string `json:"name"`
	Isolated    bool   `json:"isolated"`
	Default     bool   `json:"default"`
	Enabled     bool   `json:"enabled"`
	WMTSEnabled bool   `json:"wmtsEnabled"`
	WMSEnabled  bool   `json:"wmsEnabled"`
	WCSEnabled  bool   `json:"wcsEnabled"`
	WPSEnabled  bool   `json:"wpsEnabled"`
	WFSEnabled  bool   `json:"wfsEnabled"`
}

// WorkspaceCreateRequest represents a workspace create request
type WorkspaceCreateRequest struct {
	Name        string `json:"name"`
	Isolated    bool   `json:"isolated"`
	Default     bool   `json:"default"`
	Enabled     bool   `json:"enabled"`
	WMTSEnabled bool   `json:"wmtsEnabled"`
	WMSEnabled  bool   `json:"wmsEnabled"`
	WCSEnabled  bool   `json:"wcsEnabled"`
	WPSEnabled  bool   `json:"wpsEnabled"`
	WFSEnabled  bool   `json:"wfsEnabled"`
}

// handleWorkspaces handles workspace-related requests
// Pattern: /api/workspaces/{connId} or /api/workspaces/{connId}/{workspace}
func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	connID, workspace, _ := parsePathParams(r.URL.Path, "/api/workspaces")

	if connID == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if workspace == "" {
		// Operating on workspace collection
		switch r.Method {
		case http.MethodGet:
			s.listWorkspaces(w, r, client)
		case http.MethodPost:
			s.createWorkspace(w, r, client)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific workspace
		switch r.Method {
		case http.MethodGet:
			s.getWorkspace(w, r, client, workspace)
		case http.MethodPut:
			s.updateWorkspace(w, r, client, workspace)
		case http.MethodDelete:
			s.deleteWorkspace(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// listWorkspaces returns all workspaces for a connection
func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request, client *api.Client) {
	workspaces, err := client.GetWorkspaces()
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]WorkspaceResponse, len(workspaces))
	for i, ws := range workspaces {
		response[i] = WorkspaceResponse{
			Name:     ws.Name,
			Href:     ws.Href,
			Isolated: ws.Isolated,
		}
	}
	s.jsonResponse(w, response)
}

// getWorkspace returns a specific workspace
func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	config, err := client.GetWorkspaceConfig(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	s.jsonResponse(w, WorkspaceConfigResponse{
		Name:        config.Name,
		Isolated:    config.Isolated,
		Default:     config.Default,
		Enabled:     config.Enabled,
		WMTSEnabled: config.WMTSEnabled,
		WMSEnabled:  config.WMSEnabled,
		WCSEnabled:  config.WCSEnabled,
		WPSEnabled:  config.WPSEnabled,
		WFSEnabled:  config.WFSEnabled,
	})
}

// createWorkspace creates a new workspace
func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request, client *api.Client) {
	var req WorkspaceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Workspace name is required", http.StatusBadRequest)
		return
	}

	config := models.WorkspaceConfig{
		Name:        req.Name,
		Isolated:    req.Isolated,
		Default:     req.Default,
		Enabled:     req.Enabled,
		WMTSEnabled: req.WMTSEnabled,
		WMSEnabled:  req.WMSEnabled,
		WCSEnabled:  req.WCSEnabled,
		WPSEnabled:  req.WPSEnabled,
		WFSEnabled:  req.WFSEnabled,
	}

	if err := client.CreateWorkspaceWithConfig(config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, WorkspaceResponse{Name: req.Name})
}

// updateWorkspace updates an existing workspace
func (s *Server) updateWorkspace(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	var req WorkspaceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	config := models.WorkspaceConfig{
		Name:        req.Name,
		Isolated:    req.Isolated,
		Default:     req.Default,
		Enabled:     req.Enabled,
		WMTSEnabled: req.WMTSEnabled,
		WMSEnabled:  req.WMSEnabled,
		WCSEnabled:  req.WCSEnabled,
		WPSEnabled:  req.WPSEnabled,
		WFSEnabled:  req.WFSEnabled,
	}

	if err := client.UpdateWorkspaceWithConfig(workspace, config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, WorkspaceConfigResponse{
		Name:        config.Name,
		Isolated:    config.Isolated,
		Default:     config.Default,
		Enabled:     config.Enabled,
		WMTSEnabled: config.WMTSEnabled,
		WMSEnabled:  config.WMSEnabled,
		WCSEnabled:  config.WCSEnabled,
		WPSEnabled:  config.WPSEnabled,
		WFSEnabled:  config.WFSEnabled,
	})
}

// deleteWorkspace deletes a workspace
func (s *Server) deleteWorkspace(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	recurse := r.URL.Query().Get("recurse") == "true"

	if err := client.DeleteWorkspace(workspace, recurse); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
