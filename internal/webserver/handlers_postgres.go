package webserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kartoza/kartoza-cloudbench/internal/postgres"
)

// PGServiceResponse represents a PostgreSQL service for the API
type PGServiceResponse struct {
	Name     string `json:"name"`
	Host     string `json:"host,omitempty"`
	Port     string `json:"port,omitempty"`
	DBName   string `json:"dbname,omitempty"`
	User     string `json:"user,omitempty"`
	SSLMode  string `json:"sslmode,omitempty"`
	IsParsed bool   `json:"is_parsed"`
}

// handleGetPGServices returns all PostgreSQL services from pg_service.conf
func (s *Server) handleGetPGServices(w http.ResponseWriter, r *http.Request) {
	if !postgres.PGServiceFileExists() {
		// Return empty array if no pg_service.conf found
		json.NewEncoder(w).Encode([]PGServiceResponse{})
		return
	}

	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var response []PGServiceResponse
	for _, svc := range services {
		state := s.config.GetPGServiceState(svc.Name)
		isParsed := state != nil && state.IsParsed

		response = append(response, PGServiceResponse{
			Name:     svc.Name,
			Host:     svc.Host,
			Port:     svc.Port,
			DBName:   svc.DBName,
			User:     svc.User,
			SSLMode:  svc.SSLMode,
			IsParsed: isParsed,
		})
	}

	json.NewEncoder(w).Encode(response)
}

// PGServiceCreateRequest represents a request to create a new PostgreSQL service
type PGServiceCreateRequest struct {
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	DBName   string `json:"dbname"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSLMode  string `json:"sslmode"`
}

// handleCreatePGService creates a new PostgreSQL service entry
func (s *Server) handleCreatePGService(w http.ResponseWriter, r *http.Request) {
	var req PGServiceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Service name is required", http.StatusBadRequest)
		return
	}

	entry := postgres.ServiceEntry{
		Name:     req.Name,
		Host:     req.Host,
		Port:     req.Port,
		DBName:   req.DBName,
		User:     req.User,
		Password: req.Password,
		SSLMode:  req.SSLMode,
		Options:  make(map[string]string),
	}

	if err := postgres.SaveServiceEntry(entry); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(PGServiceResponse{
		Name:    req.Name,
		Host:    req.Host,
		Port:    req.Port,
		DBName:  req.DBName,
		User:    req.User,
		SSLMode: req.SSLMode,
	})
}

// handlePGServices handles GET /api/pg/services and POST /api/pg/services
func (s *Server) handlePGServices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		s.handleGetPGServices(w, r)
	case http.MethodPost:
		s.handleCreatePGService(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handlePGServiceByName handles /api/pg/services/{name}/* routes
func (s *Server) handlePGServiceByName(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Parse path: /api/pg/services/{name}[/action]
	path := strings.TrimPrefix(r.URL.Path, "/api/pg/services/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Service name required", http.StatusBadRequest)
		return
	}

	name := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "test":
		if r.Method == http.MethodPost {
			s.handleTestPGServiceByName(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "parse":
		if r.Method == http.MethodPost {
			s.handleParsePGServiceByName(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "schema":
		if r.Method == http.MethodGet {
			s.handleGetPGSchemaByName(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "":
		// No action - DELETE the service
		if r.Method == http.MethodDelete {
			s.handleDeletePGServiceByName(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	default:
		http.Error(w, "Unknown action: "+action, http.StatusNotFound)
	}
}

// handleTestPGServiceByName tests connectivity to a PostgreSQL service
func (s *Server) handleTestPGServiceByName(w http.ResponseWriter, r *http.Request, name string) {
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		http.Error(w, "Failed to parse pg_service.conf", http.StatusInternalServerError)
		return
	}

	svc, err := postgres.GetServiceByName(services, name)
	if err != nil {
		http.Error(w, "Service not found", http.StatusNotFound)
		return
	}

	if err := svc.TestConnection(); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Connection successful",
	})
}

// handleParsePGServiceByName harvests the schema from a PostgreSQL service
func (s *Server) handleParsePGServiceByName(w http.ResponseWriter, r *http.Request, name string) {
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		http.Error(w, "Failed to parse pg_service.conf", http.StatusInternalServerError)
		return
	}

	svc, err := postgres.GetServiceByName(services, name)
	if err != nil {
		http.Error(w, "Service not found", http.StatusNotFound)
		return
	}

	db, err := svc.Connect()
	if err != nil {
		http.Error(w, "Failed to connect: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	harvester := postgres.NewSchemaHarvester(db)
	cache, err := harvester.Harvest(name)
	if err != nil {
		http.Error(w, "Failed to harvest schema: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Mark as parsed in config
	s.config.SetPGServiceParsed(name, true)
	if err := s.config.Save(); err != nil {
		// Log but don't fail - schema was harvested successfully
	}

	json.NewEncoder(w).Encode(cache)
}

// handleGetPGSchemaByName returns the harvested schema for a PostgreSQL service
func (s *Server) handleGetPGSchemaByName(w http.ResponseWriter, r *http.Request, name string) {
	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		http.Error(w, "Failed to parse pg_service.conf", http.StatusInternalServerError)
		return
	}

	svc, err := postgres.GetServiceByName(services, name)
	if err != nil {
		http.Error(w, "Service not found", http.StatusNotFound)
		return
	}

	// Check if already parsed
	state := s.config.GetPGServiceState(name)
	if state == nil || !state.IsParsed {
		http.Error(w, "Service has not been parsed. Call POST /api/pg/services/{name}/parse first", http.StatusBadRequest)
		return
	}

	// Re-harvest the schema (in production you'd cache this)
	db, err := svc.Connect()
	if err != nil {
		http.Error(w, "Failed to connect: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	harvester := postgres.NewSchemaHarvester(db)
	cache, err := harvester.Harvest(name)
	if err != nil {
		http.Error(w, "Failed to harvest schema: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(cache)
}

// handleDeletePGServiceByName deletes a PostgreSQL service entry
func (s *Server) handleDeletePGServiceByName(w http.ResponseWriter, r *http.Request, name string) {
	if err := postgres.DeleteServiceEntry(name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Remove from config state
	s.config.RemovePGServiceState(name)
	s.config.Save()

	w.WriteHeader(http.StatusNoContent)
}
