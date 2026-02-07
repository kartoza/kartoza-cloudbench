package api

import (
	"testing"

	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

func getTestClient() *Client {
	conn := &config.Connection{
		URL:      "http://localhost:8600/geoserver",
		Username: "admin",
		Password: "geoserver",
	}
	return NewClient(conn)
}

func TestGetWorkspacesEmpty(t *testing.T) {
	client := getTestClient()

	workspaces, err := client.GetWorkspaces()
	if err != nil {
		t.Fatalf("GetWorkspaces failed: %v", err)
	}
	t.Logf("Got %d workspaces", len(workspaces))
}

func TestGetLayerConfig(t *testing.T) {
	client := getTestClient()

	// Test with Elevation layer in Workspace
	config, err := client.GetLayerConfig("Workspace", "Elevation")
	if err != nil {
		t.Fatalf("GetLayerConfig failed: %v", err)
	}

	t.Logf("Layer config: Name=%s, Workspace=%s, Store=%s, StoreType=%s, Enabled=%v, Advertised=%v",
		config.Name, config.Workspace, config.Store, config.StoreType, config.Enabled, config.Advertised)

	// Verify expected values
	if config.Name != "Elevation" {
		t.Errorf("Expected name 'Elevation', got '%s'", config.Name)
	}
	if config.Store != "Elevation" {
		t.Errorf("Expected store 'Elevation', got '%s'", config.Store)
	}
	if config.StoreType != "coveragestore" {
		t.Errorf("Expected storeType 'coveragestore', got '%s'", config.StoreType)
	}
}

func TestUpdateLayerConfig(t *testing.T) {
	client := getTestClient()

	// Get current config
	origConfig, err := client.GetLayerConfig("Workspace", "Elevation")
	if err != nil {
		t.Fatalf("GetLayerConfig failed: %v", err)
	}

	// Disable the layer
	newConfig := models.LayerConfig{
		Name:       origConfig.Name,
		Workspace:  origConfig.Workspace,
		Store:      origConfig.Store,
		StoreType:  origConfig.StoreType,
		Enabled:    false,
		Advertised: origConfig.Advertised,
	}

	err = client.UpdateLayerConfig("Workspace", newConfig)
	if err != nil {
		t.Fatalf("UpdateLayerConfig (disable) failed: %v", err)
	}

	// Verify it's disabled
	updatedConfig, err := client.GetLayerConfig("Workspace", "Elevation")
	if err != nil {
		t.Fatalf("GetLayerConfig after update failed: %v", err)
	}

	if updatedConfig.Enabled {
		t.Error("Expected layer to be disabled")
	}

	// Re-enable the layer
	newConfig.Enabled = true
	err = client.UpdateLayerConfig("Workspace", newConfig)
	if err != nil {
		t.Fatalf("UpdateLayerConfig (enable) failed: %v", err)
	}

	// Verify it's enabled
	finalConfig, err := client.GetLayerConfig("Workspace", "Elevation")
	if err != nil {
		t.Fatalf("GetLayerConfig after re-enable failed: %v", err)
	}

	if !finalConfig.Enabled {
		t.Error("Expected layer to be enabled")
	}

	t.Log("Layer enable/disable test passed")
}

func TestGetCoverageStoresEnabled(t *testing.T) {
	client := getTestClient()

	stores, err := client.GetCoverageStores("Workspace")
	if err != nil {
		t.Fatalf("GetCoverageStores failed: %v", err)
	}

	for _, store := range stores {
		t.Logf("Coverage store: %s, Enabled: %v", store.Name, store.Enabled)
	}
}
