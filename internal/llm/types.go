package llm

import "context"

// QueryRequest represents a natural language query request
type QueryRequest struct {
	Question    string   `json:"question"`     // Natural language question
	ServiceName string   `json:"service_name"` // PostgreSQL service name
	SchemaName  string   `json:"schema_name"`  // Target schema (default: public)
	Tables      []string `json:"tables"`       // Specific tables to query (empty = all)
	MaxRows     int      `json:"max_rows"`     // Maximum rows to return (default: 100)
}

// QueryResponse represents the result of a query generation
type QueryResponse struct {
	SQL           string         `json:"sql"`            // Generated SQL query
	Explanation   string         `json:"explanation"`    // Human-readable explanation
	Confidence    float64        `json:"confidence"`     // Confidence score (0-1)
	Warnings      []string       `json:"warnings"`       // Any warnings about the query
	Alternatives  []string       `json:"alternatives"`   // Alternative SQL queries
	ExecutionPlan *ExecutionPlan `json:"execution_plan"` // Query execution plan
}

// ExecutionPlan contains information about query execution
type ExecutionPlan struct {
	EstimatedRows int64   `json:"estimated_rows"`
	EstimatedCost float64 `json:"estimated_cost"`
	UsesIndex     bool    `json:"uses_index"`
	ScanType      string  `json:"scan_type"`
}

// QueryResult contains the executed query results
type QueryResult struct {
	Columns []ColumnInfo      `json:"columns"`
	Rows    []map[string]any  `json:"rows"`
	RowCount int              `json:"row_count"`
	Duration float64          `json:"duration_ms"`
	SQL      string           `json:"sql"`
}

// ColumnInfo describes a result column
type ColumnInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}

// SchemaContext provides database schema information to the LLM
type SchemaContext struct {
	ServiceName string        `json:"service_name"`
	Database    string        `json:"database"`
	Schemas     []SchemaInfo  `json:"schemas"`
}

// SchemaInfo describes a database schema
type SchemaInfo struct {
	Name   string      `json:"name"`
	Tables []TableInfo `json:"tables"`
	Views  []ViewInfo  `json:"views"`
}

// TableInfo describes a database table
type TableInfo struct {
	Name           string       `json:"name"`
	Columns        []ColumnDef  `json:"columns"`
	PrimaryKey     []string     `json:"primary_key"`
	ForeignKeys    []ForeignKey `json:"foreign_keys"`
	HasGeometry    bool         `json:"has_geometry"`
	GeometryColumn string       `json:"geometry_column"`
	GeometryType   string       `json:"geometry_type"`
	SRID           int          `json:"srid"`
	RowCount       int64        `json:"row_count"`
}

// ColumnDef describes a table column
type ColumnDef struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Nullable     bool   `json:"nullable"`
	DefaultValue string `json:"default_value"`
	IsPrimaryKey bool   `json:"is_primary_key"`
	IsForeignKey bool   `json:"is_foreign_key"`
	References   string `json:"references"` // table.column if foreign key
}

// ForeignKey describes a foreign key constraint
type ForeignKey struct {
	Columns    []string `json:"columns"`
	RefTable   string   `json:"ref_table"`
	RefColumns []string `json:"ref_columns"`
}

// ViewInfo describes a database view
type ViewInfo struct {
	Name       string      `json:"name"`
	Columns    []ColumnDef `json:"columns"`
	Definition string      `json:"definition"`
}

// Provider defines the interface for LLM providers
type Provider interface {
	// Name returns the provider name
	Name() string

	// IsAvailable checks if the provider is configured and available
	IsAvailable() bool

	// GenerateSQL generates SQL from natural language
	GenerateSQL(ctx context.Context, req QueryRequest, schema SchemaContext) (*QueryResponse, error)

	// ExplainQuery provides a natural language explanation of a SQL query
	ExplainQuery(ctx context.Context, sql string, schema SchemaContext) (string, error)

	// SuggestOptimizations suggests query optimizations
	SuggestOptimizations(ctx context.Context, sql string, schema SchemaContext) ([]string, error)
}

// ProviderConfig contains configuration for an LLM provider
type ProviderConfig struct {
	Type        string            `json:"type"`         // "ollama", "openai", "anthropic", "embedded"
	Endpoint    string            `json:"endpoint"`     // API endpoint URL
	Model       string            `json:"model"`        // Model name
	APIKey      string            `json:"api_key"`      // API key (if required)
	MaxTokens   int               `json:"max_tokens"`   // Maximum tokens in response
	Temperature float64           `json:"temperature"`  // Sampling temperature
	Options     map[string]string `json:"options"`      // Additional options
}

// Engine is the main AI query engine
type Engine struct {
	providers []Provider
	active    Provider
}

// NewEngine creates a new AI query engine
func NewEngine() *Engine {
	return &Engine{
		providers: []Provider{},
	}
}

// RegisterProvider registers an LLM provider
func (e *Engine) RegisterProvider(p Provider) {
	e.providers = append(e.providers, p)
	if e.active == nil && p.IsAvailable() {
		e.active = p
	}
}

// SetActiveProvider sets the active provider by name
func (e *Engine) SetActiveProvider(name string) bool {
	for _, p := range e.providers {
		if p.Name() == name && p.IsAvailable() {
			e.active = p
			return true
		}
	}
	return false
}

// GetActiveProvider returns the active provider
func (e *Engine) GetActiveProvider() Provider {
	return e.active
}

// ListProviders returns all registered providers with availability status
func (e *Engine) ListProviders() []ProviderStatus {
	var status []ProviderStatus
	for _, p := range e.providers {
		status = append(status, ProviderStatus{
			Name:      p.Name(),
			Available: p.IsAvailable(),
			Active:    p == e.active,
		})
	}
	return status
}

// ProviderStatus contains provider status information
type ProviderStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Active    bool   `json:"active"`
}

// GenerateSQL generates SQL using the active provider
func (e *Engine) GenerateSQL(ctx context.Context, req QueryRequest, schema SchemaContext) (*QueryResponse, error) {
	if e.active == nil {
		return nil, ErrNoProvider
	}
	return e.active.GenerateSQL(ctx, req, schema)
}

// ExplainQuery explains a SQL query using the active provider
func (e *Engine) ExplainQuery(ctx context.Context, sql string, schema SchemaContext) (string, error) {
	if e.active == nil {
		return "", ErrNoProvider
	}
	return e.active.ExplainQuery(ctx, sql, schema)
}
