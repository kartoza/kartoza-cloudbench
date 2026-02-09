package webserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
)

// ConnectionResponse represents a connection in API responses
type ConnectionResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
	IsActive bool   `json:"isActive"`
}

// ConnectionRequest represents a connection create/update request
type ConnectionRequest struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// TestConnectionResponse represents the response from testing a connection
type TestConnectionResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Info    *api.ServerInfo    `json:"info,omitempty"`
}

// handleConnections handles GET /api/connections and POST /api/connections
func (s *Server) handleConnections(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listConnections(w, r)
	case http.MethodPost:
		s.createConnection(w, r)
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleConnectionByID handles requests to /api/connections/{id}
func (s *Server) handleConnectionByID(w http.ResponseWriter, r *http.Request) {
	// Extract connection ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/connections/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		s.jsonError(w, "Connection ID required", http.StatusBadRequest)
		return
	}

	connID := parts[0]

	// Check if this is a test request: /api/connections/{id}/test
	if len(parts) >= 2 && parts[1] == "test" {
		if r.Method == http.MethodPost || r.Method == http.MethodGet {
			s.testConnection(w, r, connID)
			return
		}
	}

	// Check if this is an info request: /api/connections/{id}/info
	if len(parts) >= 2 && parts[1] == "info" {
		if r.Method == http.MethodGet {
			s.getServerInfo(w, r, connID)
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		s.getConnection(w, r, connID)
	case http.MethodPut:
		s.updateConnection(w, r, connID)
	case http.MethodDelete:
		s.deleteConnection(w, r, connID)
	case http.MethodOptions:
		s.handleCORS(w)
	default:
		s.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listConnections returns all connections
func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	connections := make([]ConnectionResponse, len(s.config.Connections))
	for i, conn := range s.config.Connections {
		connections[i] = ConnectionResponse{
			ID:       conn.ID,
			Name:     conn.Name,
			URL:      conn.URL,
			Username: conn.Username,
			Password: conn.Password,
			IsActive: conn.ID == s.config.ActiveConnection,
		}
	}
	s.jsonResponse(w, connections)
}

// getConnection returns a single connection by ID
func (s *Server) getConnection(w http.ResponseWriter, r *http.Request, connID string) {
	conn := s.getConnectionConfig(connID)
	if conn == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	s.jsonResponse(w, ConnectionResponse{
		ID:       conn.ID,
		Name:     conn.Name,
		URL:      conn.URL,
		Username: conn.Username,
		Password: conn.Password,
		IsActive: conn.ID == s.config.ActiveConnection,
	})
}

// createConnection creates a new connection
func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	var req ConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.URL == "" {
		s.jsonError(w, "Name and URL are required", http.StatusBadRequest)
		return
	}

	// Generate unique ID
	id := generateUniqueID("conn")

	conn := config.Connection{
		ID:       id,
		Name:     req.Name,
		URL:      req.URL,
		Username: req.Username,
		Password: req.Password,
	}

	s.config.Connections = append(s.config.Connections, conn)
	s.addClient(&conn)

	if err := s.saveConfig(); err != nil {
		s.jsonError(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	s.jsonResponse(w, ConnectionResponse{
		ID:       conn.ID,
		Name:     conn.Name,
		URL:      conn.URL,
		Username: conn.Username,
		IsActive: false,
	})
}

// updateConnection updates an existing connection
func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request, connID string) {
	var req ConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Find and update the connection
	var found bool
	for i := range s.config.Connections {
		if s.config.Connections[i].ID == connID {
			if req.Name != "" {
				s.config.Connections[i].Name = req.Name
			}
			if req.URL != "" {
				s.config.Connections[i].URL = req.URL
			}
			if req.Username != "" {
				s.config.Connections[i].Username = req.Username
			}
			if req.Password != "" {
				s.config.Connections[i].Password = req.Password
			}

			// Update the client
			s.removeClient(connID)
			s.addClient(&s.config.Connections[i])
			found = true
			break
		}
	}

	if !found {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if err := s.saveConfig(); err != nil {
		s.jsonError(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	conn := s.getConnectionConfig(connID)
	s.jsonResponse(w, ConnectionResponse{
		ID:       conn.ID,
		Name:     conn.Name,
		URL:      conn.URL,
		Username: conn.Username,
		IsActive: conn.ID == s.config.ActiveConnection,
	})
}

// deleteConnection deletes a connection
func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request, connID string) {
	var found bool
	for i := range s.config.Connections {
		if s.config.Connections[i].ID == connID {
			s.config.Connections = append(s.config.Connections[:i], s.config.Connections[i+1:]...)
			s.removeClient(connID)
			if s.config.ActiveConnection == connID {
				s.config.ActiveConnection = ""
			}
			found = true
			break
		}
	}

	if !found {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	if err := s.saveConfig(); err != nil {
		s.jsonError(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// testConnection tests if a connection is valid
func (s *Server) testConnection(w http.ResponseWriter, r *http.Request, connID string) {
	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	err := client.TestConnection()
	if err != nil {
		s.jsonResponse(w, TestConnectionResponse{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	info, _ := client.GetServerInfo()
	s.jsonResponse(w, TestConnectionResponse{
		Success: true,
		Message: "Connection successful",
		Info:    info,
	})
}

// getServerInfo returns server information for a connection
func (s *Server) getServerInfo(w http.ResponseWriter, r *http.Request, connID string) {
	client := s.getClient(connID)
	if client == nil {
		s.jsonError(w, "Connection not found", http.StatusNotFound)
		return
	}

	info, err := client.GetServerInfo()
	if err != nil {
		s.jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.jsonResponse(w, info)
}

// handleCORS handles CORS preflight requests
func (s *Server) handleCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.WriteHeader(http.StatusNoContent)
}

// generateUniqueID generates a unique ID with a prefix
func generateUniqueID(prefix string) string {
	return prefix + "_" + time.Now().Format("20060102150405")
}
