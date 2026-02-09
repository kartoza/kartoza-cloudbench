package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	configDir  = "kartoza-geoserver-client"
	configFile = "config.json"
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

// Config holds the application configuration
type Config struct {
	Connections      []Connection        `json:"connections"`
	ActiveConnection string              `json:"active_connection"`
	LastLocalPath    string              `json:"last_local_path"`
	Theme            string              `json:"theme"`
	SyncConfigs      []SyncConfiguration `json:"sync_configs,omitempty"`
	PingIntervalSecs int                 `json:"ping_interval_secs,omitempty"` // Dashboard refresh interval, default 60
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
