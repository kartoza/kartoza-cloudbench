package webserver

import (
	"encoding/json"
	"net/http"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// StyleResponse represents a style in API responses
type StyleResponse struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	Format    string `json:"format,omitempty"`
}

// StyleContentResponse represents style content for editing
type StyleContentResponse struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	Format    string `json:"format"`
	Content   string `json:"content"`
}

// StyleContentRequest represents a style content update request
type StyleContentRequest struct {
	Content string `json:"content"`
	Format  string `json:"format"` // "sld" or "css"
}

// StyleCreateRequest represents a style creation request
type StyleCreateRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Format  string `json:"format"` // "sld" or "css"
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
		case http.MethodPost:
			s.createStyle(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific style
		switch r.Method {
		case http.MethodGet:
			s.getStyleContent(w, r, client, workspace, style)
		case http.MethodPut:
			s.updateStyleContent(w, r, client, workspace, style)
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

// getStyleContent returns the content of a style (SLD or CSS)
func (s *Server) getStyleContent(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, styleName string) {
	// First get style info to determine format
	styles, err := client.GetStyles(workspace)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var format string
	for _, style := range styles {
		if style.Name == styleName {
			format = style.Format
			break
		}
	}
	if format == "" {
		format = "sld" // Default to SLD if not found
	}

	// Get the content based on format
	content, err := client.GetStyleContent(workspace, styleName, format)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, StyleContentResponse{
		Name:      styleName,
		Workspace: workspace,
		Format:    format,
		Content:   content,
	})
}

// updateStyleContent updates the content of an existing style
func (s *Server) updateStyleContent(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, styleName string) {
	var req StyleContentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		s.jsonError(w, "Style content is required", http.StatusBadRequest)
		return
	}

	if req.Format == "" {
		req.Format = "sld" // Default to SLD
	}

	if err := client.UpdateStyleContent(workspace, styleName, req.Content, req.Format); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, StyleContentResponse{
		Name:      styleName,
		Workspace: workspace,
		Format:    req.Format,
		Content:   req.Content,
	})
}

// createStyle creates a new style
func (s *Server) createStyle(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	var req StyleCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		s.jsonError(w, "Style name is required", http.StatusBadRequest)
		return
	}

	if req.Content == "" {
		s.jsonError(w, "Style content is required", http.StatusBadRequest)
		return
	}

	if req.Format == "" {
		req.Format = "sld" // Default to SLD
	}

	if err := client.CreateStyle(workspace, req.Name, req.Content, req.Format); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, StyleContentResponse{
		Name:      req.Name,
		Workspace: workspace,
		Format:    req.Format,
		Content:   req.Content,
	})
}

// LayerGroupResponse represents a layer group in API responses
type LayerGroupResponse struct {
	Name      string `json:"name"`
	Workspace string `json:"workspace"`
	Mode      string `json:"mode,omitempty"`
}

// LayerGroupDetailsResponse represents detailed layer group info in API responses
type LayerGroupDetailsResponse struct {
	Name       string                   `json:"name"`
	Workspace  string                   `json:"workspace"`
	Mode       string                   `json:"mode"`
	Title      string                   `json:"title,omitempty"`
	Abstract   string                   `json:"abstract,omitempty"`
	Layers     []LayerGroupItemResponse `json:"layers"`
	Bounds     *BoundsResponse          `json:"bounds,omitempty"`
	Enabled    bool                     `json:"enabled"`
	Advertised bool                     `json:"advertised"`
}

// LayerGroupItemResponse represents a layer within a layer group
type LayerGroupItemResponse struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	StyleName string `json:"styleName,omitempty"`
}

// BoundsResponse represents geographic bounds
type BoundsResponse struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
	CRS  string  `json:"crs"`
}

// LayerGroupUpdateRequest represents a layer group update request
type LayerGroupUpdateRequest struct {
	Title   string   `json:"title,omitempty"`
	Mode    string   `json:"mode,omitempty"`
	Layers  []string `json:"layers,omitempty"`
	Enabled bool     `json:"enabled"`
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
		case http.MethodPost:
			s.createLayerGroup(w, r, client, workspace)
		case http.MethodOptions:
			s.handleCORS(w)
		default:
			s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	} else {
		// Operating on a specific layer group
		switch r.Method {
		case http.MethodGet:
			s.getLayerGroup(w, r, client, workspace, group)
		case http.MethodPut:
			s.updateLayerGroup(w, r, client, workspace, group)
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

// createLayerGroup creates a new layer group
func (s *Server) createLayerGroup(w http.ResponseWriter, r *http.Request, client *api.Client, workspace string) {
	var config models.LayerGroupCreate
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		s.jsonError(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if config.Name == "" {
		s.jsonError(w, "Layer group name is required", http.StatusBadRequest)
		return
	}

	if len(config.Layers) == 0 {
		s.jsonError(w, "At least one layer is required", http.StatusBadRequest)
		return
	}

	if err := client.CreateLayerGroup(workspace, config); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, LayerGroupResponse{
		Name:      config.Name,
		Workspace: workspace,
		Mode:      config.Mode,
	})
}

// getLayerGroup returns details for a specific layer group
func (s *Server) getLayerGroup(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, group string) {
	details, err := client.GetLayerGroup(workspace, group)
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusNotFound)
		return
	}

	response := LayerGroupDetailsResponse{
		Name:       details.Name,
		Workspace:  workspace,
		Mode:       details.Mode,
		Title:      details.Title,
		Abstract:   details.Abstract,
		Enabled:    details.Enabled,
		Advertised: details.Advertised,
		Layers:     make([]LayerGroupItemResponse, len(details.Layers)),
	}

	for i, layer := range details.Layers {
		response.Layers[i] = LayerGroupItemResponse{
			Type:      layer.Type,
			Name:      layer.Name,
			StyleName: layer.StyleName,
		}
	}

	if details.Bounds != nil {
		response.Bounds = &BoundsResponse{
			MinX: details.Bounds.MinX,
			MinY: details.Bounds.MinY,
			MaxX: details.Bounds.MaxX,
			MaxY: details.Bounds.MaxY,
			CRS:  details.Bounds.CRS,
		}
	}

	s.jsonResponse(w, response)
}

// updateLayerGroup updates a layer group
func (s *Server) updateLayerGroup(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, group string) {
	var req LayerGroupUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	update := models.LayerGroupUpdate{
		Title:   req.Title,
		Mode:    req.Mode,
		Layers:  req.Layers,
		Enabled: req.Enabled,
	}

	if err := client.UpdateLayerGroup(workspace, group, update); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return the updated layer group
	s.getLayerGroup(w, r, client, workspace, group)
}

// deleteLayerGroup deletes a layer group
func (s *Server) deleteLayerGroup(w http.ResponseWriter, r *http.Request, client *api.Client, workspace, group string) {
	if err := client.DeleteLayerGroup(workspace, group); err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
