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
	Hidden   bool   `json:"hidden"`
	Online   *bool  `json:"online,omitempty"` // nil = not checked, true/false = checked
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
			Hidden:   svc.Hidden,
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
	case "hide":
		if r.Method == http.MethodPost {
			s.handleSetPGServiceHidden(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "schema":
		if r.Method == http.MethodGet {
			s.handleGetPGSchemaByName(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "schemas":
		// Returns schema info formatted for SQL autocompletion
		if r.Method == http.MethodGet {
			s.handleGetPGSchemasForCompletion(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "stats":
		// Returns server statistics for the dashboard
		if r.Method == http.MethodGet {
			s.handleGetPGServiceStats(w, r, name)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	case "schemastats":
		// Returns schema statistics for the schema dashboard
		// URL: /api/pg/services/{name}/schemastats?schema=schemaname
		if r.Method == http.MethodGet {
			s.handleGetPGSchemaStats(w, r, name)
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

// ColumnInfoForCompletion represents column info for SQL autocompletion
type ColumnInfoForCompletion struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}

// TableInfoForCompletion represents table info for SQL autocompletion
type TableInfoForCompletion struct {
	Name    string                    `json:"name"`
	Schema  string                    `json:"schema,omitempty"`
	IsView  bool                      `json:"is_view"`
	Columns []ColumnInfoForCompletion `json:"columns"`
}

// SchemaInfoForCompletion represents schema info for SQL autocompletion
type SchemaInfoForCompletion struct {
	Name   string                   `json:"name"`
	Tables []TableInfoForCompletion `json:"tables"`
}

// handleGetPGSchemasForCompletion returns schema info formatted for SQL autocompletion
func (s *Server) handleGetPGSchemasForCompletion(w http.ResponseWriter, r *http.Request, name string) {
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

	// Get all schemas
	schemaQuery := `
		SELECT schema_name
		FROM information_schema.schemata
		WHERE schema_name NOT LIKE 'pg_%'
		  AND schema_name != 'information_schema'
		ORDER BY schema_name
	`
	schemaRows, err := db.Query(schemaQuery)
	if err != nil {
		http.Error(w, "Failed to query schemas: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer schemaRows.Close()

	var schemas []SchemaInfoForCompletion
	var schemaNames []string

	for schemaRows.Next() {
		var schemaName string
		if err := schemaRows.Scan(&schemaName); err != nil {
			continue
		}
		schemaNames = append(schemaNames, schemaName)
		schemas = append(schemas, SchemaInfoForCompletion{
			Name:   schemaName,
			Tables: []TableInfoForCompletion{},
		})
	}

	// Get tables and columns for each schema
	for i, schemaName := range schemaNames {
		tableQuery := `
			SELECT t.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable
			FROM information_schema.tables t
			JOIN information_schema.columns c
				ON t.table_schema = c.table_schema
				AND t.table_name = c.table_name
			WHERE t.table_schema = $1
			  AND t.table_type IN ('BASE TABLE', 'VIEW')
			ORDER BY t.table_name, c.ordinal_position
		`

		rows, err := db.Query(tableQuery, schemaName)
		if err != nil {
			continue
		}

		tableMap := make(map[string]*TableInfoForCompletion)
		for rows.Next() {
			var tableName, tableType, colName, dataType, isNullable string
			if err := rows.Scan(&tableName, &tableType, &colName, &dataType, &isNullable); err != nil {
				continue
			}

			if _, exists := tableMap[tableName]; !exists {
				tableMap[tableName] = &TableInfoForCompletion{
					Name:    tableName,
					Schema:  schemaName,
					IsView:  tableType == "VIEW",
					Columns: []ColumnInfoForCompletion{},
				}
			}

			tableMap[tableName].Columns = append(tableMap[tableName].Columns, ColumnInfoForCompletion{
				Name:     colName,
				Type:     dataType,
				Nullable: isNullable == "YES",
			})
		}
		rows.Close()

		// Convert map to slice and sort alphabetically
		tableSlice := make([]TableInfoForCompletion, 0, len(tableMap))
		for _, table := range tableMap {
			tableSlice = append(tableSlice, *table)
		}
		// Sort by name
		for j := 0; j < len(tableSlice)-1; j++ {
			for k := j + 1; k < len(tableSlice); k++ {
				if tableSlice[j].Name > tableSlice[k].Name {
					tableSlice[j], tableSlice[k] = tableSlice[k], tableSlice[j]
				}
			}
		}
		schemas[i].Tables = tableSlice
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"schemas": schemas,
	})
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

// PGServiceHideRequest represents a request to set hidden state
type PGServiceHideRequest struct {
	Hidden bool `json:"hidden"`
}

// handleSetPGServiceHidden sets the hidden state for a PostgreSQL service
func (s *Server) handleSetPGServiceHidden(w http.ResponseWriter, r *http.Request, name string) {
	var req PGServiceHideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := postgres.SetServiceHidden(name, req.Hidden); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"hidden":  req.Hidden,
	})
}

// handleGetPGServiceStats returns comprehensive statistics for a PostgreSQL service
func (s *Server) handleGetPGServiceStats(w http.ResponseWriter, r *http.Request, name string) {
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

	stats, err := svc.GetServerStats()
	if err != nil {
		http.Error(w, "Failed to get server stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(stats)
}

// handleGetPGSchemaStats returns comprehensive statistics for a specific schema
func (s *Server) handleGetPGSchemaStats(w http.ResponseWriter, r *http.Request, serviceName string) {
	schemaName := r.URL.Query().Get("schema")
	if schemaName == "" {
		http.Error(w, "Schema name is required (use ?schema=schemaname)", http.StatusBadRequest)
		return
	}

	services, err := postgres.ParsePGServiceFile()
	if err != nil {
		http.Error(w, "Failed to parse pg_service.conf", http.StatusInternalServerError)
		return
	}

	svc, err := postgres.GetServiceByName(services, serviceName)
	if err != nil {
		http.Error(w, "Service not found", http.StatusNotFound)
		return
	}

	stats, err := svc.GetSchemaStats(schemaName)
	if err != nil {
		http.Error(w, "Failed to get schema stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(stats)
}
