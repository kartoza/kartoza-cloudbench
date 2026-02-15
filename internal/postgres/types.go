package postgres

import "time"

// SchemaCache holds the cached schema information for a PostgreSQL service
type SchemaCache struct {
	ServiceName string         `json:"service_name"`
	Tables      []TableInfo    `json:"tables"`
	Views       []ViewInfo     `json:"views"`
	Functions   []FunctionInfo `json:"functions"`
	CachedAt    time.Time      `json:"cached_at"`
	HasPostGIS  bool           `json:"has_postgis"`
	Version     string         `json:"version"`
}

// TableInfo represents a database table
type TableInfo struct {
	Schema  string       `json:"schema"`
	Name    string       `json:"name"`
	Columns []ColumnInfo `json:"columns"`
	Comment string       `json:"comment,omitempty"`
}

// ViewInfo represents a database view
type ViewInfo struct {
	Schema     string       `json:"schema"`
	Name       string       `json:"name"`
	Columns    []ColumnInfo `json:"columns"`
	Comment    string       `json:"comment,omitempty"`
	Definition string       `json:"definition,omitempty"`
}

// ColumnInfo represents a table column
type ColumnInfo struct {
	Name         string `json:"name"`
	DataType     string `json:"data_type"`
	IsNullable   bool   `json:"is_nullable"`
	IsPrimaryKey bool   `json:"is_primary_key"`
	IsForeignKey bool   `json:"is_foreign_key"`
	FKTable      string `json:"fk_table,omitempty"`
	FKColumn     string `json:"fk_column,omitempty"`
	Comment      string `json:"comment,omitempty"`
	IsGeometry   bool   `json:"is_geometry"`
	GeomType     string `json:"geom_type,omitempty"`
	SRID         int    `json:"srid,omitempty"`
}

// FunctionInfo represents a database function
type FunctionInfo struct {
	Schema     string `json:"schema"`
	Name       string `json:"name"`
	ReturnType string `json:"return_type"`
	Arguments  string `json:"arguments"`
	Comment    string `json:"comment,omitempty"`
}
