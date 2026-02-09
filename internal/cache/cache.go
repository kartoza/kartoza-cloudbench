// Package cache provides local caching for GeoServer resources
package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
)

// ResourceType represents the type of cached resource
type ResourceType string

const (
	ResourceTypeWorkspace     ResourceType = "workspace"
	ResourceTypeDataStore     ResourceType = "datastore"
	ResourceTypeCoverageStore ResourceType = "coveragestore"
	ResourceTypeFeatureType   ResourceType = "featuretype"
	ResourceTypeCoverage      ResourceType = "coverage"
	ResourceTypeStyle         ResourceType = "style"
	ResourceTypeLayerGroup    ResourceType = "layergroup"
	ResourceTypeLayer         ResourceType = "layer"
)

// CacheEntry represents metadata about a cached resource
type CacheEntry struct {
	ResourceType  ResourceType `json:"resource_type"`
	Workspace     string       `json:"workspace"`
	StoreName     string       `json:"store_name,omitempty"`
	ResourceName  string       `json:"resource_name"`
	SourceServer  string       `json:"source_server"`
	CachedAt      time.Time    `json:"cached_at"`
	Checksum      string       `json:"checksum"`
	MetadataFile  string       `json:"metadata_file"`
	DataFile      string       `json:"data_file,omitempty"`
	StyleFormat   string       `json:"style_format,omitempty"`
}

// Manager manages the local cache directory
type Manager struct {
	cacheDir string
}

// NewManager creates a new cache manager
func NewManager() (*Manager, error) {
	// Get cache directory from XDG or default
	cacheDir := os.Getenv("XDG_CACHE_HOME")
	if cacheDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get home directory: %w", err)
		}
		cacheDir = filepath.Join(homeDir, ".cache")
	}
	cacheDir = filepath.Join(cacheDir, "kartoza-geoserver", "sync-cache")

	// Ensure cache directory exists
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create cache directory: %w", err)
	}

	return &Manager{cacheDir: cacheDir}, nil
}

// CacheDir returns the cache directory path
func (m *Manager) CacheDir() string {
	return m.cacheDir
}

// resourcePath returns the path for a specific resource in the cache
func (m *Manager) resourcePath(serverID, workspace string, resType ResourceType, storeName, resourceName string) string {
	if storeName != "" {
		return filepath.Join(m.cacheDir, serverID, workspace, string(resType), storeName, resourceName)
	}
	return filepath.Join(m.cacheDir, serverID, workspace, string(resType), resourceName)
}

// CacheWorkspace downloads and caches a workspace configuration
func (m *Manager) CacheWorkspace(client *api.Client, serverID, workspace string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeWorkspace, "", workspace)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download workspace metadata
	data, err := client.DownloadWorkspace(workspace)
	if err != nil {
		return nil, fmt.Errorf("failed to download workspace: %w", err)
	}

	metaFile := filepath.Join(path, "workspace.json")
	if err := os.WriteFile(metaFile, data, 0644); err != nil {
		return nil, err
	}

	entry := &CacheEntry{
		ResourceType: ResourceTypeWorkspace,
		Workspace:    workspace,
		ResourceName: workspace,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(data),
		MetadataFile: metaFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheDataStore downloads and caches a data store configuration
func (m *Manager) CacheDataStore(client *api.Client, serverID, workspace, storeName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeDataStore, "", storeName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download datastore metadata
	data, err := client.DownloadDataStore(workspace, storeName)
	if err != nil {
		return nil, fmt.Errorf("failed to download datastore: %w", err)
	}

	metaFile := filepath.Join(path, "datastore.json")
	if err := os.WriteFile(metaFile, data, 0644); err != nil {
		return nil, err
	}

	entry := &CacheEntry{
		ResourceType: ResourceTypeDataStore,
		Workspace:    workspace,
		StoreName:    storeName,
		ResourceName: storeName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(data),
		MetadataFile: metaFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheFeatureType downloads and caches a feature type with its data
func (m *Manager) CacheFeatureType(client *api.Client, serverID, workspace, storeName, featureTypeName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeFeatureType, storeName, featureTypeName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download feature type metadata
	metaData, err := client.DownloadFeatureType(workspace, storeName, featureTypeName)
	if err != nil {
		return nil, fmt.Errorf("failed to download feature type metadata: %w", err)
	}

	metaFile := filepath.Join(path, "featuretype.json")
	if err := os.WriteFile(metaFile, metaData, 0644); err != nil {
		return nil, err
	}

	// Download actual data via WFS as shapefile
	shapeData, err := client.DownloadLayerAsShapefile(workspace, featureTypeName)
	if err != nil {
		// Data download failed, but we still have metadata
		entry := &CacheEntry{
			ResourceType: ResourceTypeFeatureType,
			Workspace:    workspace,
			StoreName:    storeName,
			ResourceName: featureTypeName,
			SourceServer: serverID,
			CachedAt:     time.Now(),
			Checksum:     computeChecksum(metaData),
			MetadataFile: metaFile,
		}
		return entry, m.saveEntry(path, entry)
	}

	dataFile := filepath.Join(path, "data.shp.zip")
	if err := os.WriteFile(dataFile, shapeData, 0644); err != nil {
		return nil, err
	}

	// Compute combined checksum
	combined := append(metaData, shapeData...)
	entry := &CacheEntry{
		ResourceType: ResourceTypeFeatureType,
		Workspace:    workspace,
		StoreName:    storeName,
		ResourceName: featureTypeName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(combined),
		MetadataFile: metaFile,
		DataFile:     dataFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheCoverageStore downloads and caches a coverage store configuration
func (m *Manager) CacheCoverageStore(client *api.Client, serverID, workspace, storeName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeCoverageStore, "", storeName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download coverage store metadata
	data, err := client.DownloadCoverageStore(workspace, storeName)
	if err != nil {
		return nil, fmt.Errorf("failed to download coverage store: %w", err)
	}

	metaFile := filepath.Join(path, "coveragestore.json")
	if err := os.WriteFile(metaFile, data, 0644); err != nil {
		return nil, err
	}

	entry := &CacheEntry{
		ResourceType: ResourceTypeCoverageStore,
		Workspace:    workspace,
		StoreName:    storeName,
		ResourceName: storeName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(data),
		MetadataFile: metaFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheCoverage downloads and caches a coverage with its data
func (m *Manager) CacheCoverage(client *api.Client, serverID, workspace, storeName, coverageName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeCoverage, storeName, coverageName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download coverage metadata
	metaData, err := client.DownloadCoverage(workspace, storeName, coverageName)
	if err != nil {
		return nil, fmt.Errorf("failed to download coverage metadata: %w", err)
	}

	metaFile := filepath.Join(path, "coverage.json")
	if err := os.WriteFile(metaFile, metaData, 0644); err != nil {
		return nil, err
	}

	// Download actual data via WCS as GeoTIFF
	tiffData, err := client.DownloadCoverageAsGeoTIFF(workspace, coverageName)
	if err != nil {
		// Data download failed, but we still have metadata
		entry := &CacheEntry{
			ResourceType: ResourceTypeCoverage,
			Workspace:    workspace,
			StoreName:    storeName,
			ResourceName: coverageName,
			SourceServer: serverID,
			CachedAt:     time.Now(),
			Checksum:     computeChecksum(metaData),
			MetadataFile: metaFile,
		}
		return entry, m.saveEntry(path, entry)
	}

	dataFile := filepath.Join(path, "data.tif")
	if err := os.WriteFile(dataFile, tiffData, 0644); err != nil {
		return nil, err
	}

	// Compute combined checksum
	combined := append(metaData, tiffData...)
	entry := &CacheEntry{
		ResourceType: ResourceTypeCoverage,
		Workspace:    workspace,
		StoreName:    storeName,
		ResourceName: coverageName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(combined),
		MetadataFile: metaFile,
		DataFile:     dataFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheStyle downloads and caches a style with its definition
func (m *Manager) CacheStyle(client *api.Client, serverID, workspace, styleName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeStyle, "", styleName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download style content (SLD/CSS)
	styleData, ext, err := client.DownloadStyle(workspace, styleName)
	if err != nil {
		return nil, fmt.Errorf("failed to download style: %w", err)
	}

	// Determine format from extension
	format := "sld"
	if ext == ".css" {
		format = "css"
	} else if ext == ".json" {
		format = "mbstyle"
	}

	dataFile := filepath.Join(path, "style"+ext)
	if err := os.WriteFile(dataFile, styleData, 0644); err != nil {
		return nil, err
	}

	// Also get the style metadata (if available)
	// Note: style metadata is in the style info endpoint
	metaFile := filepath.Join(path, "style-info.json")

	entry := &CacheEntry{
		ResourceType: ResourceTypeStyle,
		Workspace:    workspace,
		ResourceName: styleName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(styleData),
		MetadataFile: metaFile,
		DataFile:     dataFile,
		StyleFormat:  format,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheLayerGroup downloads and caches a layer group configuration
func (m *Manager) CacheLayerGroup(client *api.Client, serverID, workspace, groupName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeLayerGroup, "", groupName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download layer group metadata
	data, err := client.DownloadLayerGroup(workspace, groupName)
	if err != nil {
		return nil, fmt.Errorf("failed to download layer group: %w", err)
	}

	metaFile := filepath.Join(path, "layergroup.json")
	if err := os.WriteFile(metaFile, data, 0644); err != nil {
		return nil, err
	}

	entry := &CacheEntry{
		ResourceType: ResourceTypeLayerGroup,
		Workspace:    workspace,
		ResourceName: groupName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(data),
		MetadataFile: metaFile,
	}

	return entry, m.saveEntry(path, entry)
}

// CacheLayer downloads and caches a layer configuration
func (m *Manager) CacheLayer(client *api.Client, serverID, workspace, layerName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, ResourceTypeLayer, "", layerName)
	if err := os.MkdirAll(path, 0755); err != nil {
		return nil, err
	}

	// Download layer metadata
	data, err := client.DownloadLayer(workspace, layerName)
	if err != nil {
		return nil, fmt.Errorf("failed to download layer: %w", err)
	}

	metaFile := filepath.Join(path, "layer.json")
	if err := os.WriteFile(metaFile, data, 0644); err != nil {
		return nil, err
	}

	entry := &CacheEntry{
		ResourceType: ResourceTypeLayer,
		Workspace:    workspace,
		ResourceName: layerName,
		SourceServer: serverID,
		CachedAt:     time.Now(),
		Checksum:     computeChecksum(data),
		MetadataFile: metaFile,
	}

	return entry, m.saveEntry(path, entry)
}

// GetCacheEntry retrieves a cache entry if it exists
func (m *Manager) GetCacheEntry(serverID, workspace string, resType ResourceType, storeName, resourceName string) (*CacheEntry, error) {
	path := m.resourcePath(serverID, workspace, resType, storeName, resourceName)
	entryFile := filepath.Join(path, "cache-entry.json")

	data, err := os.ReadFile(entryFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // Not cached
		}
		return nil, err
	}

	var entry CacheEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, err
	}

	return &entry, nil
}

// IsCacheValid checks if the cached resource matches the source
func (m *Manager) IsCacheValid(client *api.Client, entry *CacheEntry) (bool, error) {
	if entry == nil {
		return false, nil
	}

	// Read the cached metadata file and compute checksum
	data, err := os.ReadFile(entry.MetadataFile)
	if err != nil {
		return false, nil // File missing, cache invalid
	}

	// If there's a data file, include it in checksum
	if entry.DataFile != "" {
		dataContent, err := os.ReadFile(entry.DataFile)
		if err != nil {
			return false, nil
		}
		data = append(data, dataContent...)
	}

	currentChecksum := computeChecksum(data)
	return currentChecksum == entry.Checksum, nil
}

// ReadCachedData reads the cached data file
func (m *Manager) ReadCachedData(entry *CacheEntry) ([]byte, error) {
	if entry.DataFile == "" {
		return nil, fmt.Errorf("no data file in cache entry")
	}
	return os.ReadFile(entry.DataFile)
}

// ReadCachedMetadata reads the cached metadata file
func (m *Manager) ReadCachedMetadata(entry *CacheEntry) ([]byte, error) {
	return os.ReadFile(entry.MetadataFile)
}

// ClearCache removes all cached data for a server
func (m *Manager) ClearCache(serverID string) error {
	path := filepath.Join(m.cacheDir, serverID)
	return os.RemoveAll(path)
}

// ClearAllCache removes all cached data
func (m *Manager) ClearAllCache() error {
	return os.RemoveAll(m.cacheDir)
}

// saveEntry saves a cache entry metadata file
func (m *Manager) saveEntry(path string, entry *CacheEntry) error {
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(path, "cache-entry.json"), data, 0644)
}

// computeChecksum computes SHA256 checksum of data
func computeChecksum(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// GetCacheStats returns statistics about the cache
func (m *Manager) GetCacheStats() (int64, int, error) {
	var totalSize int64
	var fileCount int

	err := filepath.Walk(m.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if !info.IsDir() {
			totalSize += info.Size()
			fileCount++
		}
		return nil
	})

	return totalSize, fileCount, err
}

// DefaultManager is the global cache manager instance
var DefaultManager *Manager

func init() {
	var err error
	DefaultManager, err = NewManager()
	if err != nil {
		// Log error but don't fail - cache is optional
		fmt.Fprintf(os.Stderr, "Warning: failed to initialize cache: %v\n", err)
	}
}

// GetConnection helper to get connection by ID
func GetConnection(cfg *config.Config, connID string) *config.Connection {
	for i := range cfg.Connections {
		if cfg.Connections[i].ID == connID {
			return &cfg.Connections[i]
		}
	}
	return nil
}
