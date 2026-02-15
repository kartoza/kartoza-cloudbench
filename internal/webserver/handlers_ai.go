package webserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/kartoza/kartoza-cloudbench/internal/llm"
)

// AI Query Engine state
var (
	aiEngine   *llm.Engine
	aiExecutor *llm.QueryExecutor
)

func init() {
	// Initialize AI engine with default providers
	aiEngine = llm.NewEngine()

	// Register Ollama provider (default)
	ollamaConfig := llm.ProviderConfig{
		Endpoint:    "http://localhost:11434",
		Model:       "llama3.2",
		MaxTokens:   2048,
		Temperature: 0.1,
	}
	aiEngine.RegisterProvider(llm.NewOllamaProvider(ollamaConfig))

	// Initialize executor with safe defaults
	aiExecutor = llm.NewQueryExecutor(
		llm.WithMaxRows(100),
		llm.WithTimeout(30*time.Second),
		llm.WithReadOnly(true),
	)
}

// AIQueryRequest represents a natural language query request
type AIQueryRequest struct {
	Question    string   `json:"question"`
	ServiceName string   `json:"service_name"`
	SchemaName  string   `json:"schema_name"`
	Tables      []string `json:"tables"`
	MaxRows     int      `json:"max_rows"`
	Execute     bool     `json:"execute"` // Whether to execute the generated SQL
}

// AIQueryResponse represents the response from the AI query endpoint
type AIQueryResponse struct {
	Success     bool              `json:"success"`
	SQL         string            `json:"sql,omitempty"`
	Explanation string            `json:"explanation,omitempty"`
	Confidence  float64           `json:"confidence,omitempty"`
	Warnings    []string          `json:"warnings,omitempty"`
	Result      *llm.QueryResult  `json:"result,omitempty"`
	Error       string            `json:"error,omitempty"`
	Duration    float64           `json:"duration_ms,omitempty"`
}

// handleAIQuery handles POST /api/ai/query - generate and optionally execute SQL
func (s *Server) handleAIQuery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AIQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "Invalid request body",
		})
		return
	}

	if req.Question == "" {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "Question is required",
		})
		return
	}

	if req.ServiceName == "" {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "service_name is required",
		})
		return
	}

	// Check if AI provider is available
	if aiEngine.GetActiveProvider() == nil {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "No AI provider available. Please ensure Ollama is running.",
		})
		return
	}

	startTime := time.Now()

	// Build schema context
	schemaCtx, err := llm.BuildSchemaContext(req.ServiceName)
	if err != nil {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "Failed to get schema: " + err.Error(),
		})
		return
	}

	// Filter to specific schema if requested
	if req.SchemaName != "" {
		var filteredSchemas []llm.SchemaInfo
		for _, s := range schemaCtx.Schemas {
			if s.Name == req.SchemaName {
				filteredSchemas = append(filteredSchemas, s)
				break
			}
		}
		schemaCtx.Schemas = filteredSchemas
	}

	// Generate SQL
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	queryReq := llm.QueryRequest{
		Question:    req.Question,
		ServiceName: req.ServiceName,
		SchemaName:  req.SchemaName,
		Tables:      req.Tables,
		MaxRows:     req.MaxRows,
	}

	queryResp, err := aiEngine.GenerateSQL(ctx, queryReq, *schemaCtx)
	if err != nil {
		json.NewEncoder(w).Encode(AIQueryResponse{
			Success: false,
			Error:   "Failed to generate SQL: " + err.Error(),
		})
		return
	}

	response := AIQueryResponse{
		Success:     true,
		SQL:         queryResp.SQL,
		Explanation: queryResp.Explanation,
		Confidence:  queryResp.Confidence,
		Warnings:    queryResp.Warnings,
	}

	// Execute if requested
	if req.Execute && queryResp.SQL != "" {
		result, err := aiExecutor.Execute(ctx, req.ServiceName, queryResp.SQL)
		if err != nil {
			response.Warnings = append(response.Warnings, "Execution failed: "+err.Error())
		} else {
			response.Result = result
		}
	}

	response.Duration = time.Since(startTime).Seconds() * 1000

	json.NewEncoder(w).Encode(response)
}

// handleAIExplain handles POST /api/ai/explain - explain a SQL query
func (s *Server) handleAIExplain(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SQL         string `json:"sql"`
		ServiceName string `json:"service_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.SQL == "" {
		s.jsonError(w, "sql is required", http.StatusBadRequest)
		return
	}

	if aiEngine.GetActiveProvider() == nil {
		s.jsonError(w, "No AI provider available", http.StatusServiceUnavailable)
		return
	}

	// Build schema context if service provided
	var schemaCtx llm.SchemaContext
	if req.ServiceName != "" {
		ctx, err := llm.BuildSchemaContext(req.ServiceName)
		if err == nil {
			schemaCtx = *ctx
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	explanation, err := aiEngine.ExplainQuery(ctx, req.SQL, schemaCtx)
	if err != nil {
		s.jsonError(w, "Failed to explain query: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"explanation": explanation,
	})
}

// handleAIProviders handles GET /api/ai/providers - list available providers
func (s *Server) handleAIProviders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	providers := aiEngine.ListProviders()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"providers": providers,
	})
}

// handleAIExecute handles POST /api/ai/execute - execute a SQL query
func (s *Server) handleAIExecute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SQL         string `json:"sql"`
		ServiceName string `json:"service_name"`
		MaxRows     int    `json:"max_rows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.jsonError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.SQL == "" {
		s.jsonError(w, "sql is required", http.StatusBadRequest)
		return
	}

	if req.ServiceName == "" {
		s.jsonError(w, "service_name is required", http.StatusBadRequest)
		return
	}

	// Create executor with custom max rows if specified
	executor := aiExecutor
	if req.MaxRows > 0 && req.MaxRows != 100 {
		executor = llm.NewQueryExecutor(
			llm.WithMaxRows(req.MaxRows),
			llm.WithTimeout(30*time.Second),
			llm.WithReadOnly(true),
		)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := executor.Execute(ctx, req.ServiceName, req.SQL)
	if err != nil {
		s.jsonError(w, "Query execution failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"result":  result,
	})
}

// handleAI handles /api/ai/* routes
func (s *Server) handleAI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/ai")
	path = strings.Trim(path, "/")

	switch path {
	case "query":
		s.handleAIQuery(w, r)
	case "explain":
		s.handleAIExplain(w, r)
	case "execute":
		s.handleAIExecute(w, r)
	case "providers":
		s.handleAIProviders(w, r)
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}
