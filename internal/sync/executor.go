package sync

import (
	"fmt"
	"strings"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/cache"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// Executor handles the actual sync operations
type Executor struct {
	task         *Task
	sourceClient *api.Client
	destClient   *api.Client
	options      config.SyncOptions
	stopChan     chan struct{}
	sourceID     string // Source connection ID for cache
	cacheManager *cache.Manager
}

// Execute runs the sync operation
func (e *Executor) Execute() {
	e.task.AddLog("Analyzing source server...")

	if e.options.Workspaces {
		workspaces, err := e.sourceClient.GetWorkspaces()
		if err != nil {
			e.task.SetError(fmt.Sprintf("Failed to get workspaces: %v", err))
			return
		}

		for _, ws := range workspaces {
			if e.isStopped() {
				return
			}

			// Check workspace filter
			if len(e.options.WorkspaceFilter) > 0 {
				if !e.matchesFilter(ws.Name) {
					continue
				}
			}

			e.syncWorkspace(ws.Name)
		}
	}

	// Sync global styles
	if e.options.Styles {
		e.syncGlobalStyles()
	}

	e.task.AddLog("Sync completed!")
}

func (e *Executor) isStopped() bool {
	select {
	case <-e.stopChan:
		return true
	default:
		return false
	}
}

func (e *Executor) matchesFilter(name string) bool {
	for _, f := range e.options.WorkspaceFilter {
		if f == name {
			return true
		}
	}
	return false
}

func (e *Executor) syncWorkspace(name string) {
	e.task.IncrementTotal()
	e.task.SetCurrentItem(fmt.Sprintf("Workspace: %s", name))
	e.task.AddLog(fmt.Sprintf("Syncing workspace: %s", name))

	// Try to create workspace on destination
	err := e.destClient.CreateWorkspace(name)
	if err != nil {
		if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "409") {
			e.task.IncrementSkipped()
			e.task.AddLog(fmt.Sprintf("Workspace %s already exists, skipping", name))
		} else {
			e.task.IncrementFailed()
			e.task.AddLog(fmt.Sprintf("Failed to create workspace %s: %v", name, err))
		}
	} else {
		e.task.IncrementDone()
		e.task.AddLog(fmt.Sprintf("Created workspace: %s", name))
	}
	e.task.UpdateProgress()

	// Sync styles for this workspace
	if e.options.Styles {
		e.syncWorkspaceStyles(name)
	}

	// Sync data stores
	if e.options.DataStores {
		e.syncDataStores(name)
	}

	// Sync coverage stores
	if e.options.CoverageStores {
		e.syncCoverageStores(name)
	}

	// Sync layer groups
	if e.options.LayerGroups {
		e.syncLayerGroups(name)
	}
}

func (e *Executor) syncWorkspaceStyles(workspace string) {
	styles, err := e.sourceClient.GetStyles(workspace)
	if err != nil {
		e.task.AddLog(fmt.Sprintf("Failed to get styles for %s: %v", workspace, err))
		return
	}

	for _, style := range styles {
		if e.isStopped() {
			return
		}

		e.task.IncrementTotal()
		e.task.SetCurrentItem(fmt.Sprintf("Style: %s:%s", workspace, style.Name))

		// Get style content from source
		sld, err := e.sourceClient.GetStyleSLD(workspace, style.Name)
		if err != nil {
			e.task.IncrementFailed()
			e.task.AddLog(fmt.Sprintf("Failed to get style %s: %v", style.Name, err))
			continue
		}

		// Create on destination
		err = e.destClient.CreateOrUpdateStyle(workspace, style.Name, sld)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") {
				e.task.IncrementSkipped()
			} else {
				e.task.IncrementFailed()
				e.task.AddLog(fmt.Sprintf("Failed to create style %s: %v", style.Name, err))
			}
		} else {
			e.task.IncrementDone()
		}
		e.task.UpdateProgress()
	}
}

func (e *Executor) syncGlobalStyles() {
	styles, err := e.sourceClient.GetStyles("")
	if err != nil {
		e.task.AddLog(fmt.Sprintf("Failed to get global styles: %v", err))
		return
	}

	for _, style := range styles {
		if e.isStopped() {
			return
		}

		e.task.IncrementTotal()
		e.task.SetCurrentItem(fmt.Sprintf("Global Style: %s", style.Name))

		sld, err := e.sourceClient.GetStyleSLD("", style.Name)
		if err != nil {
			e.task.IncrementFailed()
			continue
		}

		err = e.destClient.CreateOrUpdateStyle("", style.Name, sld)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") {
				e.task.IncrementSkipped()
			} else {
				e.task.IncrementFailed()
			}
		} else {
			e.task.IncrementDone()
		}
		e.task.UpdateProgress()
	}
}

func (e *Executor) syncDataStores(workspace string) {
	stores, err := e.sourceClient.GetDataStores(workspace)
	if err != nil {
		e.task.AddLog(fmt.Sprintf("Failed to get data stores for %s: %v", workspace, err))
		return
	}

	for _, store := range stores {
		if e.isStopped() {
			return
		}

		e.task.IncrementTotal()
		e.task.SetCurrentItem(fmt.Sprintf("DataStore: %s:%s", workspace, store.Name))
		e.task.AddLog(fmt.Sprintf("Syncing data store: %s", store.Name))

		// Handle based on sync strategy
		switch e.options.DataStoreStrategy {
		case config.DataStoreSameConnection:
			// Skip - this would require same DB access which isn't network-only
			e.task.AddLog(fmt.Sprintf("Strategy: Same Connection - Skipping %s (requires destination to have same DB access)", store.Name))
			e.task.IncrementSkipped()
		case config.DataStoreGeoPackageCopy:
			// Network-based: download data via WFS and upload to destination
			e.syncDataStoreViaWFS(workspace, store.Name)
		default: // Skip
			e.task.AddLog(fmt.Sprintf("Strategy: Skip - Data store %s noted (requires manual configuration)", store.Name))
			e.task.IncrementSkipped()
		}
		e.task.UpdateProgress()
	}
}

// syncDataStoreViaWFS downloads feature data via WFS to cache and uploads to destination
// This creates new datastores on destination with the actual data
func (e *Executor) syncDataStoreViaWFS(workspace, storeName string) {
	e.task.AddLog(fmt.Sprintf("Strategy: Data Copy via Cache - Syncing data from %s", storeName))

	// Get all feature types from this store
	featureTypes, err := e.sourceClient.GetFeatureTypes(workspace, storeName)
	if err != nil {
		e.task.IncrementFailed()
		e.task.AddLog(fmt.Sprintf("Failed to get feature types for %s: %v", storeName, err))
		return
	}

	if len(featureTypes) == 0 {
		e.task.AddLog(fmt.Sprintf("No feature types found in store %s", storeName))
		e.task.IncrementSkipped()
		return
	}

	// For each feature type, check cache -> download if needed -> upload from cache
	syncedAny := false
	for _, ft := range featureTypes {
		if e.isStopped() {
			return
		}

		e.task.SetCurrentItem(fmt.Sprintf("Syncing: %s:%s", workspace, ft.Name))

		var shapeData []byte
		var cacheEntry *cache.CacheEntry

		// Check if we have a valid cache entry
		if e.cacheManager != nil {
			cacheEntry, _ = e.cacheManager.GetCacheEntry(e.sourceID, workspace, cache.ResourceTypeFeatureType, storeName, ft.Name)
			if cacheEntry != nil && cacheEntry.DataFile != "" {
				// Check if cache is still valid
				valid, _ := e.cacheManager.IsCacheValid(e.sourceClient, cacheEntry)
				if valid {
					e.task.AddLog(fmt.Sprintf("Using cached data for %s", ft.Name))
					shapeData, err = e.cacheManager.ReadCachedData(cacheEntry)
					if err != nil {
						e.task.AddLog(fmt.Sprintf("Cache read failed, re-downloading: %v", err))
						cacheEntry = nil
					}
				} else {
					e.task.AddLog(fmt.Sprintf("Cache outdated for %s, re-downloading", ft.Name))
					cacheEntry = nil
				}
			}
		}

		// If no valid cache, download to cache
		if cacheEntry == nil || shapeData == nil {
			e.task.AddLog(fmt.Sprintf("Downloading %s (metadata + data via WFS)...", ft.Name))

			if e.cacheManager != nil {
				// Download to cache (includes both metadata and data)
				cacheEntry, err = e.cacheManager.CacheFeatureType(e.sourceClient, e.sourceID, workspace, storeName, ft.Name)
				if err != nil {
					e.task.AddLog(fmt.Sprintf("Failed to cache %s: %v", ft.Name, err))
					continue
				}
				if cacheEntry.DataFile != "" {
					shapeData, err = e.cacheManager.ReadCachedData(cacheEntry)
					if err != nil {
						e.task.AddLog(fmt.Sprintf("Failed to read cached data for %s: %v", ft.Name, err))
						continue
					}
				} else {
					e.task.AddLog(fmt.Sprintf("No data file in cache for %s (WFS download may have failed)", ft.Name))
					continue
				}
			} else {
				// No cache manager, download directly
				shapeData, err = e.sourceClient.DownloadLayerAsShapefile(workspace, ft.Name)
				if err != nil {
					e.task.AddLog(fmt.Sprintf("Failed to download %s via WFS: %v", ft.Name, err))
					continue
				}
			}
		}

		e.task.AddLog(fmt.Sprintf("Uploading %s (%.2f KB) to destination...", ft.Name, float64(len(shapeData))/1024))

		// Upload to destination - use feature type name as store name
		destStoreName := ft.Name
		err = e.destClient.UploadShapefileData(workspace, destStoreName, shapeData)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "409") {
				e.task.AddLog(fmt.Sprintf("Store %s already exists on destination, skipping", destStoreName))
			} else {
				e.task.AddLog(fmt.Sprintf("Failed to upload %s: %v", ft.Name, err))
			}
			continue
		}

		e.task.AddLog(fmt.Sprintf("Successfully synced layer: %s", ft.Name))
		syncedAny = true
	}

	if syncedAny {
		e.task.IncrementDone()
	} else {
		e.task.IncrementSkipped()
	}
}

func (e *Executor) syncCoverageStores(workspace string) {
	stores, err := e.sourceClient.GetCoverageStores(workspace)
	if err != nil {
		e.task.AddLog(fmt.Sprintf("Failed to get coverage stores for %s: %v", workspace, err))
		return
	}

	for _, store := range stores {
		if e.isStopped() {
			return
		}

		e.task.IncrementTotal()
		e.task.SetCurrentItem(fmt.Sprintf("CoverageStore: %s:%s", workspace, store.Name))
		e.task.AddLog(fmt.Sprintf("Syncing coverage store: %s", store.Name))

		// Use WCS to download raster data and upload to destination
		e.syncCoverageStoreViaWCS(workspace, store.Name)
		e.task.UpdateProgress()
	}
}

// syncCoverageStoreViaWCS downloads coverage data via WCS to cache and uploads to destination
func (e *Executor) syncCoverageStoreViaWCS(workspace, storeName string) {
	e.task.AddLog(fmt.Sprintf("Strategy: Data Copy via Cache - Syncing raster from %s", storeName))

	// Get all coverages from this store
	coverages, err := e.sourceClient.GetCoverages(workspace, storeName)
	if err != nil {
		e.task.IncrementFailed()
		e.task.AddLog(fmt.Sprintf("Failed to get coverages for %s: %v", storeName, err))
		return
	}

	if len(coverages) == 0 {
		e.task.AddLog(fmt.Sprintf("No coverages found in store %s", storeName))
		e.task.IncrementSkipped()
		return
	}

	// For each coverage, check cache -> download if needed -> upload from cache
	syncedAny := false
	for _, cov := range coverages {
		if e.isStopped() {
			return
		}

		e.task.SetCurrentItem(fmt.Sprintf("Syncing: %s:%s", workspace, cov.Name))

		var tiffData []byte
		var cacheEntry *cache.CacheEntry

		// Check if we have a valid cache entry
		if e.cacheManager != nil {
			cacheEntry, _ = e.cacheManager.GetCacheEntry(e.sourceID, workspace, cache.ResourceTypeCoverage, storeName, cov.Name)
			if cacheEntry != nil && cacheEntry.DataFile != "" {
				// Check if cache is still valid
				valid, _ := e.cacheManager.IsCacheValid(e.sourceClient, cacheEntry)
				if valid {
					e.task.AddLog(fmt.Sprintf("Using cached data for %s", cov.Name))
					tiffData, err = e.cacheManager.ReadCachedData(cacheEntry)
					if err != nil {
						e.task.AddLog(fmt.Sprintf("Cache read failed, re-downloading: %v", err))
						cacheEntry = nil
					}
				} else {
					e.task.AddLog(fmt.Sprintf("Cache outdated for %s, re-downloading", cov.Name))
					cacheEntry = nil
				}
			}
		}

		// If no valid cache, download to cache
		if cacheEntry == nil || tiffData == nil {
			e.task.AddLog(fmt.Sprintf("Downloading %s (metadata + data via WCS)...", cov.Name))

			if e.cacheManager != nil {
				// Download to cache (includes both metadata and data)
				cacheEntry, err = e.cacheManager.CacheCoverage(e.sourceClient, e.sourceID, workspace, storeName, cov.Name)
				if err != nil {
					e.task.AddLog(fmt.Sprintf("Failed to cache %s: %v", cov.Name, err))
					continue
				}
				if cacheEntry.DataFile != "" {
					tiffData, err = e.cacheManager.ReadCachedData(cacheEntry)
					if err != nil {
						e.task.AddLog(fmt.Sprintf("Failed to read cached data for %s: %v", cov.Name, err))
						continue
					}
				} else {
					e.task.AddLog(fmt.Sprintf("No data file in cache for %s (WCS download may have failed)", cov.Name))
					continue
				}
			} else {
				// No cache manager, download directly
				tiffData, err = e.sourceClient.DownloadCoverageAsGeoTIFF(workspace, cov.Name)
				if err != nil {
					e.task.AddLog(fmt.Sprintf("Failed to download %s via WCS: %v", cov.Name, err))
					continue
				}
			}
		}

		e.task.AddLog(fmt.Sprintf("Uploading %s (%.2f MB) to destination...", cov.Name, float64(len(tiffData))/(1024*1024)))

		// Upload to destination - use coverage name as store name
		destStoreName := cov.Name
		err = e.destClient.UploadGeoTIFFData(workspace, destStoreName, tiffData)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "409") {
				e.task.AddLog(fmt.Sprintf("Store %s already exists on destination, skipping", destStoreName))
			} else {
				e.task.AddLog(fmt.Sprintf("Failed to upload %s: %v", cov.Name, err))
			}
			continue
		}

		e.task.AddLog(fmt.Sprintf("Successfully synced coverage: %s", cov.Name))
		syncedAny = true
	}

	if syncedAny {
		e.task.IncrementDone()
	} else {
		e.task.IncrementSkipped()
	}
}

func (e *Executor) syncLayerGroups(workspace string) {
	groups, err := e.sourceClient.GetLayerGroups(workspace)
	if err != nil {
		e.task.AddLog(fmt.Sprintf("Failed to get layer groups for %s: %v", workspace, err))
		return
	}

	for _, group := range groups {
		if e.isStopped() {
			return
		}

		e.task.IncrementTotal()
		e.task.SetCurrentItem(fmt.Sprintf("LayerGroup: %s:%s", workspace, group.Name))
		e.task.AddLog(fmt.Sprintf("Syncing layer group: %s", group.Name))

		// Get layer group details from source
		details, err := e.sourceClient.GetLayerGroup(workspace, group.Name)
		if err != nil {
			e.task.IncrementFailed()
			e.task.AddLog(fmt.Sprintf("Failed to get layer group details for %s: %v", group.Name, err))
			e.task.UpdateProgress()
			continue
		}

		// Extract layer names from the details
		layerNames := make([]string, 0, len(details.Layers))
		for _, item := range details.Layers {
			// Format as workspace:layername
			layerNames = append(layerNames, fmt.Sprintf("%s:%s", workspace, item.Name))
		}

		// Create the layer group on destination
		createConfig := models.LayerGroupCreate{
			Name:   group.Name,
			Title:  details.Title,
			Mode:   details.Mode,
			Layers: layerNames,
		}

		err = e.destClient.CreateLayerGroup(workspace, createConfig)
		if err != nil {
			if strings.Contains(err.Error(), "already exists") || strings.Contains(err.Error(), "409") {
				e.task.IncrementSkipped()
				e.task.AddLog(fmt.Sprintf("LayerGroup %s already exists on destination", group.Name))
			} else {
				e.task.IncrementFailed()
				e.task.AddLog(fmt.Sprintf("Failed to create layer group %s: %v", group.Name, err))
			}
		} else {
			e.task.IncrementDone()
			e.task.AddLog(fmt.Sprintf("Created layer group: %s", group.Name))
		}
		e.task.UpdateProgress()
	}
}
