package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	configDir    = "kartoza-cloudbench"
	oldConfigDir = "kartoza-geoserver-client" // For migration
	configFile   = "config.json"
)

// Connection represents a GeoServer connection configuration
type Connection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
	IsActive bool   `json:"is_active"`
}

// SyncConfiguration represents a saved sync setup
type SyncConfiguration struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	SourceID     string   `json:"source_id"`      // Connection ID of source server
	DestIDs      []string `json:"destination_ids"` // Connection IDs of destination servers
	SyncOptions  SyncOptions `json:"options"`
	CreatedAt    string   `json:"created_at"`
	LastSyncedAt string   `json:"last_synced_at,omitempty"`
}

// DataStoreSyncStrategy defines how datastores should be synced
type DataStoreSyncStrategy string

const (
	// DataStoreSameConnection copies datastore config as-is (requires same DB access)
	DataStoreSameConnection DataStoreSyncStrategy = "same_connection"
	// DataStoreGeoPackageCopy exports data to GeoPackage and syncs as file store
	DataStoreGeoPackageCopy DataStoreSyncStrategy = "geopackage_copy"
	// DataStoreSkip skips datastore syncing entirely (default, just note it)
	DataStoreSkip DataStoreSyncStrategy = "skip"
)

// SyncOptions configures what to sync
type SyncOptions struct {
	Workspaces      bool `json:"workspaces"`
	DataStores      bool `json:"datastores"`
	CoverageStores  bool `json:"coveragestores"`
	Layers          bool `json:"layers"`
	Styles          bool `json:"styles"`
	LayerGroups     bool `json:"layergroups"`
	// Filter options
	WorkspaceFilter []string `json:"workspace_filter,omitempty"` // If set, only sync these workspaces
	// Datastore sync strategy
	DataStoreStrategy DataStoreSyncStrategy `json:"datastore_strategy,omitempty"` // How to sync datastores
}

// DefaultSyncOptions returns default sync options (sync everything)
func DefaultSyncOptions() SyncOptions {
	return SyncOptions{
		Workspaces:        true,
		DataStores:        true,
		CoverageStores:    true,
		Layers:            true,
		Styles:            true,
		LayerGroups:       true,
		DataStoreStrategy: DataStoreSkip, // Default to skip for safety
	}
}

// PGServiceState tracks the parsed state of a PostgreSQL service
type PGServiceState struct {
	Name     string `json:"name"`
	IsParsed bool   `json:"is_parsed"`
	// SchemaCache is stored separately to avoid bloating the main config
}

// Config holds the application configuration
type Config struct {
	Connections      []Connection        `json:"connections"`
	ActiveConnection string              `json:"active_connection"`
	LastLocalPath    string              `json:"last_local_path"`
	Theme            string              `json:"theme"`
	SyncConfigs      []SyncConfiguration `json:"sync_configs,omitempty"`
	PingIntervalSecs int                 `json:"ping_interval_secs,omitempty"` // Dashboard refresh interval, default 60
	PGServiceStates  []PGServiceState    `json:"pg_services,omitempty"`        // PostgreSQL service states
}

// GetPingInterval returns the ping interval in seconds, with a default of 60
func (c *Config) GetPingInterval() int {
	if c.PingIntervalSecs <= 0 {
		return 60
	}
	return c.PingIntervalSecs
}

// SetPingInterval sets the ping interval in seconds
func (c *Config) SetPingInterval(seconds int) {
	if seconds < 10 {
		seconds = 10 // Minimum 10 seconds
	}
	if seconds > 600 {
		seconds = 600 // Maximum 10 minutes
	}
	c.PingIntervalSecs = seconds
}

// DefaultConfig returns the default configuration
func DefaultConfig() *Config {
	home, _ := os.UserHomeDir()
	return &Config{
		Connections:   []Connection{},
		LastLocalPath: home,
		Theme:         "default",
	}
}

// configPath returns the path to the config file
func configPath() (string, error) {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		configHome = filepath.Join(home, ".config")
	}

	return filepath.Join(configHome, configDir, configFile), nil
}

// Load loads the configuration from disk
func Load() (*Config, error) {
	// Try to migrate from old config location if new one doesn't exist
	if err := migrateOldConfig(); err != nil {
		// Log but don't fail - migration is best-effort
		fmt.Fprintf(os.Stderr, "Config migration warning: %v\n", err)
	}

	path, err := configPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	return &cfg, nil
}

// migrateOldConfig migrates config from old kartoza-geoserver-client directory
func migrateOldConfig() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	oldPath := filepath.Join(homeDir, ".config", oldConfigDir, configFile)
	newPath := filepath.Join(homeDir, ".config", configDir, configFile)

	// Check if old config exists and new doesn't
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		return nil // No old config to migrate
	}
	if _, err := os.Stat(newPath); err == nil {
		return nil // New config already exists
	}

	// Create new config directory
	newDir := filepath.Dir(newPath)
	if err := os.MkdirAll(newDir, 0755); err != nil {
		return fmt.Errorf("failed to create new config dir: %w", err)
	}

	// Copy old config to new location
	data, err := os.ReadFile(oldPath)
	if err != nil {
		return fmt.Errorf("failed to read old config: %w", err)
	}

	if err := os.WriteFile(newPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write new config: %w", err)
	}

	fmt.Printf("Migrated config from %s to %s\n", oldPath, newPath)
	return nil
}

// Save saves the configuration to disk
func (c *Config) Save() error {
	path, err := configPath()
	if err != nil {
		return err
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	// Atomic write using temp file
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return fmt.Errorf("failed to write config: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

// GetActiveConnection returns the currently active connection
func (c *Config) GetActiveConnection() *Connection {
	for i := range c.Connections {
		if c.Connections[i].ID == c.ActiveConnection {
			return &c.Connections[i]
		}
	}
	return nil
}

// AddConnection adds a new connection
func (c *Config) AddConnection(conn Connection) {
	c.Connections = append(c.Connections, conn)
}

// RemoveConnection removes a connection by ID
func (c *Config) RemoveConnection(id string) {
	for i, conn := range c.Connections {
		if conn.ID == id {
			c.Connections = append(c.Connections[:i], c.Connections[i+1:]...)
			if c.ActiveConnection == id {
				c.ActiveConnection = ""
			}
			return
		}
	}
}

// SetActiveConnection sets the active connection by ID
func (c *Config) SetActiveConnection(id string) {
	c.ActiveConnection = id
}

// AddSyncConfig adds a new sync configuration
func (c *Config) AddSyncConfig(cfg SyncConfiguration) {
	c.SyncConfigs = append(c.SyncConfigs, cfg)
}

// GetSyncConfig returns a sync configuration by ID
func (c *Config) GetSyncConfig(id string) *SyncConfiguration {
	for i := range c.SyncConfigs {
		if c.SyncConfigs[i].ID == id {
			return &c.SyncConfigs[i]
		}
	}
	return nil
}

// UpdateSyncConfig updates an existing sync configuration
func (c *Config) UpdateSyncConfig(cfg SyncConfiguration) bool {
	for i := range c.SyncConfigs {
		if c.SyncConfigs[i].ID == cfg.ID {
			c.SyncConfigs[i] = cfg
			return true
		}
	}
	return false
}

// RemoveSyncConfig removes a sync configuration by ID
func (c *Config) RemoveSyncConfig(id string) {
	for i, cfg := range c.SyncConfigs {
		if cfg.ID == id {
			c.SyncConfigs = append(c.SyncConfigs[:i], c.SyncConfigs[i+1:]...)
			return
		}
	}
}

// GetConnection returns a connection by ID
func (c *Config) GetConnection(id string) *Connection {
	for i := range c.Connections {
		if c.Connections[i].ID == id {
			return &c.Connections[i]
		}
	}
	return nil
}

// GetPGServiceState returns the state for a PostgreSQL service
func (c *Config) GetPGServiceState(name string) *PGServiceState {
	for i := range c.PGServiceStates {
		if c.PGServiceStates[i].Name == name {
			return &c.PGServiceStates[i]
		}
	}
	return nil
}

// SetPGServiceParsed marks a PostgreSQL service as parsed
func (c *Config) SetPGServiceParsed(name string, parsed bool) {
	for i := range c.PGServiceStates {
		if c.PGServiceStates[i].Name == name {
			c.PGServiceStates[i].IsParsed = parsed
			return
		}
	}
	// Add new entry
	c.PGServiceStates = append(c.PGServiceStates, PGServiceState{
		Name:     name,
		IsParsed: parsed,
	})
}

// RemovePGServiceState removes the state for a PostgreSQL service
func (c *Config) RemovePGServiceState(name string) {
	for i := range c.PGServiceStates {
		if c.PGServiceStates[i].Name == name {
			c.PGServiceStates = append(c.PGServiceStates[:i], c.PGServiceStates[i+1:]...)
			return
		}
	}
}
