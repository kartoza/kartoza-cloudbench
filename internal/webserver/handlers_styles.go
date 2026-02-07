package webserver

import (
	"net/http"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
)

// StyleResponse represents a style in API responses
type StyleResponse struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	Format    string `json:"format,omitempty"`
}

// handleStyles handles style related requests
// Pattern: /api/styles/{connId}/{workspace} or /api/styles/{connId}/{workspace}/{style}
func (s *Server) handleStyles(w http.ResponseWriter, r *http.Request) {
	connID, workspace, style := parsePathParams(r.URL.Path, "/api/styles")

	if connID == "" {
		s.jsonError(w, "Connection ID is required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if style == "" {
		// Operating on style collection
		switch r.Method {
		case http.MethodGet:
			s.listStyles(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific style
		switch r.Method {
		case http.MethodDelete:
			s.deleteStyle(w, r, client, workspace, style)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// listStyles returns all styles for a workspace
func (s *Server) listStyles(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	styles, err := client.GetStyles(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]StyleResponse, len(styles))
	for i, style := range styles {
		response[i] = StyleResponse{
			Name:      style.Name,
			Workspace: workspace,
			Format:    style.Format,
		}
	}
	s.jsonResponse(w, response)
}

// deleteStyle deletes a style
func (s *Server) deleteStyle(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, style string) {
	purge := r.URL.Query().Get("purge") == "true"

	if err := client.DeleteStyle(workspace, style, purge); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// LayerGroupResponse represents a layer group in API responses
type LayerGroupResponse struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	Mode      string `json:"mode,omitempty"`
}

// handleLayerGroups handles layer group related requests
// Pattern: /api/layergroups/{connId}/{workspace} or /api/layergroups/{connId}/{workspace}/{group}
func (s *Server) handleLayerGroups(w http.ResponseWriter, r *http.Request) {
	connID, workspace, group := parsePathParams(r.URL.Path, "/api/layergroups")

	if connID == "" {
		s.jsonError(w, "Connection ID is required", http.StatusBadRequest)
		return
	}

	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if group == "" {
		// Operating on layer group collection
		switch r.Method {
		case http.MethodGet:
			s.listLayerGroups(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific layer group
		switch r.Method {
		case http.MethodDelete:
			s.deleteLayerGroup(w, r, client, workspace, group)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// listLayerGroups returns all layer groups for a workspace
func (s *Server) listLayerGroups(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	groups, err := client.GetLayerGroups(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]LayerGroupResponse, len(groups))
	for i, group := range groups {
		response[i] = LayerGroupResponse{
			Name:      group.Name,
			Workspace: workspace,
			Mode:      group.Mode,
		}
	}
	s.jsonResponse(w, response)
}

// deleteLayerGroup deletes a layer group
func (s *Server) deleteLayerGroup(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, group string) {
	if err := client.DeleteLayerGroup(workspace, group); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
