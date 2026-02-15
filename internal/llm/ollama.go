package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OllamaProvider implements the Provider interface for Ollama
type OllamaProvider struct {
	config ProviderConfig
	client *http.Client
}

// NewOllamaProvider creates a new Ollama provider
func NewOllamaProvider(config ProviderConfig) *OllamaProvider {
	if config.Endpoint == "" {
		config.Endpoint = "http://localhost:11434"
	}
	if config.Model == "" {
		config.Model = "llama3.2"
	}
	if config.MaxTokens == 0 {
		config.MaxTokens = 2048
	}
	if config.Temperature == 0 {
		config.Temperature = 0.1 // Low temperature for deterministic SQL generation
	}

	return &OllamaProvider{
		config: config,
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// Name returns the provider name
func (p *OllamaProvider) Name() string {
	return "ollama"
}

// IsAvailable checks if Ollama is running and the model is available
func (p *OllamaProvider) IsAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", p.config.Endpoint+"/api/tags", nil)
	if err != nil {
		return false
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

// ollamaRequest is the request structure for Ollama API
type ollamaRequest struct {
	Model    string                 `json:"model"`
	Prompt   string                 `json:"prompt"`
	Stream   bool                   `json:"stream"`
	Options  map[string]interface{} `json:"options,omitempty"`
}

// ollamaResponse is the response structure from Ollama API
type ollamaResponse struct {
	Model    string `json:"model"`
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

// GenerateSQL generates SQL from natural language using Ollama
func (p *OllamaProvider) GenerateSQL(ctx context.Context, req QueryRequest, schema SchemaContext) (*QueryResponse, error) {
	prompt := p.buildSQLPrompt(req, schema)

	ollamaReq := ollamaRequest{
		Model:  p.config.Model,
		Prompt: prompt,
		Stream: false,
		Options: map[string]interface{}{
			"temperature":   p.config.Temperature,
			"num_predict":   p.config.MaxTokens,
			"stop":          []string{"```", "\n\n\n"},
		},
	}

	body, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.config.Endpoint+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call Ollama: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Ollama returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var ollamaResp ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Parse the SQL from the response
	sql, explanation, confidence := p.parseResponse(ollamaResp.Response)

	// Validate the SQL
	warnings := p.validateSQL(sql, schema)

	return &QueryResponse{
		SQL:         sql,
		Explanation: explanation,
		Confidence:  confidence,
		Warnings:    warnings,
	}, nil
}

// buildSQLPrompt constructs the prompt for SQL generation
func (p *OllamaProvider) buildSQLPrompt(req QueryRequest, schema SchemaContext) string {
	var sb strings.Builder

	sb.WriteString("You are a PostgreSQL/PostGIS SQL expert. Generate a single SQL query based on the user's question.\n\n")

	// Add schema context
	sb.WriteString("DATABASE SCHEMA:\n")
	sb.WriteString(fmt.Sprintf("Database: %s\n", schema.Database))

	for _, s := range schema.Schemas {
		sb.WriteString(fmt.Sprintf("\nSchema: %s\n", s.Name))
		for _, t := range s.Tables {
			sb.WriteString(fmt.Sprintf("  Table: %s\n", t.Name))
			for _, c := range t.Columns {
				nullable := ""
				if !c.Nullable {
					nullable = " NOT NULL"
				}
				pk := ""
				if c.IsPrimaryKey {
					pk = " PRIMARY KEY"
				}
				sb.WriteString(fmt.Sprintf("    - %s: %s%s%s\n", c.Name, c.Type, nullable, pk))
			}
			if t.HasGeometry {
				sb.WriteString(fmt.Sprintf("    [GEOMETRY: %s (%s), SRID: %d]\n", t.GeometryColumn, t.GeometryType, t.SRID))
			}
		}
	}

	sb.WriteString("\nRULES:\n")
	sb.WriteString("1. Output ONLY the SQL query, no explanations\n")
	sb.WriteString("2. Use proper PostgreSQL syntax\n")
	sb.WriteString("3. For spatial queries, use PostGIS functions (ST_*)\n")
	sb.WriteString("4. Always include a LIMIT clause (default 100)\n")
	sb.WriteString("5. Use table aliases for readability\n")
	sb.WriteString("6. Never use DELETE, DROP, TRUNCATE, or UPDATE without WHERE\n")

	if req.MaxRows > 0 {
		sb.WriteString(fmt.Sprintf("7. Maximum rows: %d\n", req.MaxRows))
	}

	sb.WriteString("\nQUESTION: ")
	sb.WriteString(req.Question)
	sb.WriteString("\n\nSQL:\n")

	return sb.String()
}

// parseResponse extracts SQL and explanation from the LLM response
func (p *OllamaProvider) parseResponse(response string) (sql, explanation string, confidence float64) {
	response = strings.TrimSpace(response)

	// Remove markdown code blocks if present
	if strings.HasPrefix(response, "```sql") {
		response = strings.TrimPrefix(response, "```sql")
		if idx := strings.Index(response, "```"); idx != -1 {
			response = response[:idx]
		}
	} else if strings.HasPrefix(response, "```") {
		response = strings.TrimPrefix(response, "```")
		if idx := strings.Index(response, "```"); idx != -1 {
			response = response[:idx]
		}
	}

	sql = strings.TrimSpace(response)

	// Check for common SQL patterns to estimate confidence
	confidence = 0.5
	sqlUpper := strings.ToUpper(sql)

	if strings.HasPrefix(sqlUpper, "SELECT") {
		confidence = 0.8
	}
	if strings.Contains(sqlUpper, "FROM") {
		confidence += 0.1
	}
	if strings.Contains(sqlUpper, "WHERE") || strings.Contains(sqlUpper, "LIMIT") {
		confidence += 0.05
	}

	// Cap confidence at 0.95
	if confidence > 0.95 {
		confidence = 0.95
	}

	return sql, "", confidence
}

// validateSQL performs basic SQL validation
func (p *OllamaProvider) validateSQL(sql string, schema SchemaContext) []string {
	var warnings []string
	sqlUpper := strings.ToUpper(sql)

	// Check for dangerous operations
	if strings.Contains(sqlUpper, "DROP") {
		warnings = append(warnings, "Query contains DROP statement - review carefully")
	}
	if strings.Contains(sqlUpper, "DELETE") && !strings.Contains(sqlUpper, "WHERE") {
		warnings = append(warnings, "DELETE without WHERE clause detected")
	}
	if strings.Contains(sqlUpper, "TRUNCATE") {
		warnings = append(warnings, "Query contains TRUNCATE statement - review carefully")
	}
	if strings.Contains(sqlUpper, "UPDATE") && !strings.Contains(sqlUpper, "WHERE") {
		warnings = append(warnings, "UPDATE without WHERE clause detected")
	}

	// Check for missing LIMIT on SELECT
	if strings.HasPrefix(sqlUpper, "SELECT") && !strings.Contains(sqlUpper, "LIMIT") {
		warnings = append(warnings, "SELECT without LIMIT - may return many rows")
	}

	return warnings
}

// ExplainQuery provides a natural language explanation of a SQL query
func (p *OllamaProvider) ExplainQuery(ctx context.Context, sql string, schema SchemaContext) (string, error) {
	prompt := fmt.Sprintf(`Explain what this SQL query does in plain English. Be concise.

SQL Query:
%s

Explanation:`, sql)

	ollamaReq := ollamaRequest{
		Model:  p.config.Model,
		Prompt: prompt,
		Stream: false,
		Options: map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 500,
		},
	}

	body, err := json.Marshal(ollamaReq)
	if err != nil {
		return "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.config.Endpoint+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var ollamaResp ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return "", err
	}

	return strings.TrimSpace(ollamaResp.Response), nil
}

// SuggestOptimizations suggests query optimizations
func (p *OllamaProvider) SuggestOptimizations(ctx context.Context, sql string, schema SchemaContext) ([]string, error) {
	prompt := fmt.Sprintf(`Analyze this SQL query and suggest optimizations. List each suggestion on a new line starting with "- ".

SQL Query:
%s

Suggestions:`, sql)

	ollamaReq := ollamaRequest{
		Model:  p.config.Model,
		Prompt: prompt,
		Stream: false,
		Options: map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 500,
		},
	}

	body, err := json.Marshal(ollamaReq)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.config.Endpoint+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var ollamaResp ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return nil, err
	}

	// Parse suggestions from response
	var suggestions []string
	lines := strings.Split(ollamaResp.Response, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") {
			suggestions = append(suggestions, strings.TrimPrefix(strings.TrimPrefix(line, "- "), "* "))
		}
	}

	return suggestions, nil
}
