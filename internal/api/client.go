package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// Client is a GeoServer REST API client
type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
}

// NewClient creates a new GeoServer API client
func NewClient(conn *config.Connection) *Client {
	return &Client{
		baseURL:  strings.TrimSuffix(conn.URL, "/"),
		username: conn.Username,
		password: conn.Password,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// BaseURL returns the base URL of the GeoServer
func (c *Client) BaseURL() string {
	return c.baseURL
}

// doRequest performs an HTTP request with authentication
func (c *Client) doRequest(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	url := c.baseURL + "/rest" + path

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

// doJSONRequest performs a JSON request
func (c *Client) doJSONRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}
	return c.doRequest(method, path, bodyReader, "application/json")
}

// TestConnection tests if the connection is valid
func (c *Client) TestConnection() error {
	resp, err := c.doRequest("GET", "/about/version", nil, "")
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("connection failed with status: %d", resp.StatusCode)
	}

	return nil
}

// ServerInfo contains information about the GeoServer instance
type ServerInfo struct {
	GeoServerVersion   string
	GeoServerBuild     string
	GeoServerRevision  string
	GeoToolsVersion    string
	GeoWebCacheVersion string
}

// GetServerInfo fetches information about the GeoServer instance
func (c *Client) GetServerInfo() (*ServerInfo, error) {
	resp, err := c.doRequest("GET", "/about/version", nil, "")
	if err != nil {
		return nil, fmt.Errorf("failed to get server info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get server info: %s", string(body))
	}

	var response struct {
		About struct {
			Resource []struct {
				Name           string      `json:"@name"`
				Version        interface{} `json:"Version"`
				BuildTimestamp string      `json:"Build-Timestamp"`
				GitRevision    string      `json:"Git-Revision"`
			} `json:"resource"`
		} `json:"about"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode server info: %w", err)
	}

	info := &ServerInfo{}
	for _, r := range response.About.Resource {
		switch r.Name {
		case "GeoServer":
			info.GeoServerVersion = fmt.Sprintf("%v", r.Version)
			info.GeoServerBuild = r.BuildTimestamp
			info.GeoServerRevision = r.GitRevision
		case "GeoTools":
			info.GeoToolsVersion = fmt.Sprintf("%v", r.Version)
		case "GeoWebCache":
			info.GeoWebCacheVersion = fmt.Sprintf("%v", r.Version)
		}
	}

	return info, nil
}

// GetWorkspaces fetches all workspaces
func (c *Client) GetWorkspaces() ([]models.Workspace, error) {
	resp, err := c.doRequest("GET", "/workspaces", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get workspaces: %s", string(body))
	}

	// Read body to handle empty workspaces case
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// GeoServer returns {"workspaces": ""} when there are no workspaces
	// Check for this case first
	var emptyCheck struct {
		Workspaces interface{} `json:"workspaces"`
	}
	if err := json.Unmarshal(body, &emptyCheck); err != nil {
		return nil, fmt.Errorf("failed to decode workspaces: %w", err)
	}

	// If workspaces is a string (empty), return empty slice
	if _, ok := emptyCheck.Workspaces.(string); ok {
		return []models.Workspace{}, nil
	}

	// Otherwise parse normally
	var result struct {
		Workspaces struct {
			Workspace []models.Workspace `json:"workspace"`
		} `json:"workspaces"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode workspaces: %w", err)
	}

	return result.Workspaces.Workspace, nil
}

// GetDataStores fetches all data stores for a workspace
func (c *Client) GetDataStores(workspace string) ([]models.DataStore, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores", workspace), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get datastores: %s", string(body))
	}

	var result struct {
		DataStores struct {
			DataStore []models.DataStore `json:"dataStore"`
		} `json:"dataStores"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode datastores: %w", err)
	}

	// Fetch enabled status for each store (list endpoint doesn't include it)
	for i := range result.DataStores.DataStore {
		result.DataStores.DataStore[i].Workspace = workspace
		// Get individual store to fetch enabled status
		storeResp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, result.DataStores.DataStore[i].Name), nil, "")
		if err == nil {
			defer storeResp.Body.Close()
			if storeResp.StatusCode == http.StatusOK {
				var storeDetail struct {
					DataStore struct {
						Enabled bool `json:"enabled"`
					} `json:"dataStore"`
				}
				if json.NewDecoder(storeResp.Body).Decode(&storeDetail) == nil {
					result.DataStores.DataStore[i].Enabled = storeDetail.DataStore.Enabled
				}
			}
		}
	}

	return result.DataStores.DataStore, nil
}

// GetCoverageStores fetches all coverage stores for a workspace
func (c *Client) GetCoverageStores(workspace string) ([]models.CoverageStore, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores", workspace), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get coverage stores: %s", string(body))
	}

	var result struct {
		CoverageStores struct {
			CoverageStore []models.CoverageStore `json:"coverageStore"`
		} `json:"coverageStores"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode coverage stores: %w", err)
	}

	// Fetch enabled status for each store (list endpoint doesn't include it)
	for i := range result.CoverageStores.CoverageStore {
		result.CoverageStores.CoverageStore[i].Workspace = workspace
		// Get individual store to fetch enabled status
		storeResp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, result.CoverageStores.CoverageStore[i].Name), nil, "")
		if err == nil {
			defer storeResp.Body.Close()
			if storeResp.StatusCode == http.StatusOK {
				var storeDetail struct {
					CoverageStore struct {
						Enabled bool `json:"enabled"`
					} `json:"coverageStore"`
				}
				if json.NewDecoder(storeResp.Body).Decode(&storeDetail) == nil {
					result.CoverageStores.CoverageStore[i].Enabled = storeDetail.CoverageStore.Enabled
				}
			}
		}
	}

	return result.CoverageStores.CoverageStore, nil
}

// GetLayers fetches all layers for a workspace
func (c *Client) GetLayers(workspace string) ([]models.Layer, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/layers", workspace), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get layers: %s", string(body))
	}

	var result struct {
		Layers struct {
			Layer []models.Layer `json:"layer"`
		} `json:"layers"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode layers: %w", err)
	}

	for i := range result.Layers.Layer {
		result.Layers.Layer[i].Workspace = workspace
	}

	return result.Layers.Layer, nil
}

// GetStyles fetches all styles (global or workspace-specific)
func (c *Client) GetStyles(workspace string) ([]models.Style, error) {
	var path string
	if workspace == "" {
		path = "/styles"
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles", workspace)
	}

	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get styles: %s", string(body))
	}

	var result struct {
		Styles struct {
			Style []models.Style `json:"style"`
		} `json:"styles"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode styles: %w", err)
	}

	for i := range result.Styles.Style {
		result.Styles.Style[i].Workspace = workspace
	}

	return result.Styles.Style, nil
}

// GetLayerGroups fetches all layer groups (global or workspace-specific)
func (c *Client) GetLayerGroups(workspace string) ([]models.LayerGroup, error) {
	var path string
	if workspace == "" {
		path = "/layergroups"
	} else {
		path = fmt.Sprintf("/workspaces/%s/layergroups", workspace)
	}

	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get layer groups: %s", string(body))
	}

	var result struct {
		LayerGroups struct {
			LayerGroup []models.LayerGroup `json:"layerGroup"`
		} `json:"layerGroups"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode layer groups: %w", err)
	}

	for i := range result.LayerGroups.LayerGroup {
		result.LayerGroups.LayerGroup[i].Workspace = workspace
	}

	return result.LayerGroups.LayerGroup, nil
}

// CreateWorkspace creates a new workspace with optional configuration
func (c *Client) CreateWorkspace(name string) error {
	return c.CreateWorkspaceWithConfig(models.WorkspaceConfig{Name: name})
}

// CreateWorkspaceWithConfig creates a new workspace with full configuration
func (c *Client) CreateWorkspaceWithConfig(config models.WorkspaceConfig) error {
	// Create workspace body
	wsBody := map[string]interface{}{
		"name": config.Name,
	}
	if config.Isolated {
		wsBody["isolated"] = true
	}

	body := map[string]interface{}{
		"workspace": wsBody,
	}

	// Add default parameter to query string if true
	path := "/workspaces"
	if config.Default {
		path += "?default=true"
	}

	resp, err := c.doJSONRequest("POST", path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create workspace: %s", string(bodyBytes))
	}

	// Configure workspace settings (enabled)
	if config.Enabled {
		if err := c.UpdateWorkspaceSettings(config.Name, config.Enabled); err != nil {
			return fmt.Errorf("workspace created but failed to update settings: %w", err)
		}
	}

	// Configure service settings
	if config.WMTSEnabled {
		if err := c.EnableWorkspaceService(config.Name, "wmts", true); err != nil {
			return fmt.Errorf("workspace created but failed to enable WMTS: %w", err)
		}
	}
	if config.WMSEnabled {
		if err := c.EnableWorkspaceService(config.Name, "wms", true); err != nil {
			return fmt.Errorf("workspace created but failed to enable WMS: %w", err)
		}
	}
	if config.WCSEnabled {
		if err := c.EnableWorkspaceService(config.Name, "wcs", true); err != nil {
			return fmt.Errorf("workspace created but failed to enable WCS: %w", err)
		}
	}
	if config.WPSEnabled {
		if err := c.EnableWorkspaceService(config.Name, "wps", true); err != nil {
			return fmt.Errorf("workspace created but failed to enable WPS: %w", err)
		}
	}
	if config.WFSEnabled {
		if err := c.EnableWorkspaceService(config.Name, "wfs", true); err != nil {
			return fmt.Errorf("workspace created but failed to enable WFS: %w", err)
		}
	}

	return nil
}

// UploadShapefile uploads a shapefile to a datastore
func (c *Client) UploadShapefile(workspace, storeName, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	path := fmt.Sprintf("/workspaces/%s/datastores/%s/file.shp", workspace, storeName)
	url := c.baseURL + "/rest" + path

	// Create multipart form
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	writer.Close()

	req, err := http.NewRequest("PUT", url, &buf)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/zip")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload failed: %s", string(bodyBytes))
	}

	return nil
}

// UploadGeoTIFF uploads a GeoTIFF to a coverage store
func (c *Client) UploadGeoTIFF(workspace, storeName, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	path := fmt.Sprintf("/workspaces/%s/coveragestores/%s/file.geotiff", workspace, storeName)

	req, err := http.NewRequest("PUT", c.baseURL+"/rest"+path, file)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "image/tiff")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload failed: %s", string(bodyBytes))
	}

	return nil
}

// UploadStyle uploads a style file (SLD or CSS)
func (c *Client) UploadStyle(workspace, styleName, filePath string, format string) error {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read style file: %w", err)
	}

	// First create the style
	var path string
	if workspace == "" {
		path = "/styles"
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles", workspace)
	}

	// Determine content type based on format
	var contentType string
	switch strings.ToLower(format) {
	case "sld":
		contentType = "application/vnd.ogc.sld+xml"
	case "css":
		contentType = "application/vnd.geoserver.geocss+css"
	default:
		contentType = "application/vnd.ogc.sld+xml"
	}

	// Create style entry
	createBody := map[string]interface{}{
		"style": map[string]interface{}{
			"name":     styleName,
			"filename": filepath.Base(filePath),
		},
	}

	resp, err := c.doJSONRequest("POST", path, createBody)
	if err != nil {
		return err
	}
	resp.Body.Close()

	// Upload the actual style content
	uploadPath := path + "/" + styleName
	resp, err = c.doRequest("PUT", uploadPath, bytes.NewReader(content), contentType)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to upload style: %s", string(bodyBytes))
	}

	return nil
}

// DeleteWorkspace deletes a workspace
func (c *Client) DeleteWorkspace(name string, recurse bool) error {
	path := fmt.Sprintf("/workspaces/%s", name)
	if recurse {
		path += "?recurse=true"
	}

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete workspace: %s", string(bodyBytes))
	}

	return nil
}

// DeleteDataStore deletes a data store
func (c *Client) DeleteDataStore(workspace, name string, recurse bool) error {
	path := fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, name)
	if recurse {
		path += "?recurse=true"
	}

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete datastore: %s", string(bodyBytes))
	}

	return nil
}

// DeleteCoverageStore deletes a coverage store
func (c *Client) DeleteCoverageStore(workspace, name string, recurse bool) error {
	path := fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, name)
	if recurse {
		path += "?recurse=true"
	}

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete coverage store: %s", string(bodyBytes))
	}

	return nil
}

// DeleteLayer deletes a layer
func (c *Client) DeleteLayer(workspace, name string) error {
	path := fmt.Sprintf("/workspaces/%s/layers/%s", workspace, name)

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete layer: %s", string(bodyBytes))
	}

	return nil
}

// DeleteStyle deletes a style
func (c *Client) DeleteStyle(workspace, name string, purge bool) error {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/styles/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles/%s", workspace, name)
	}
	if purge {
		path += "?purge=true"
	}

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete style: %s", string(bodyBytes))
	}

	return nil
}

// UploadGeoPackage uploads a GeoPackage to a datastore
func (c *Client) UploadGeoPackage(workspace, storeName, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	path := fmt.Sprintf("/workspaces/%s/datastores/%s/file.gpkg", workspace, storeName)

	req, err := http.NewRequest("PUT", c.baseURL+"/rest"+path, file)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/geopackage+sqlite3")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upload failed: %s", string(bodyBytes))
	}

	return nil
}

// GetFeatureTypes fetches all feature types for a datastore
func (c *Client) GetFeatureTypes(workspace, datastore string) ([]models.FeatureType, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes", workspace, datastore), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get feature types: %s", string(body))
	}

	var result struct {
		FeatureTypes struct {
			FeatureType []models.FeatureType `json:"featureType"`
		} `json:"featureTypes"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode feature types: %w", err)
	}

	for i := range result.FeatureTypes.FeatureType {
		result.FeatureTypes.FeatureType[i].Workspace = workspace
		result.FeatureTypes.FeatureType[i].Store = datastore
	}

	return result.FeatureTypes.FeatureType, nil
}

// GetCoverages fetches all coverages for a coverage store
func (c *Client) GetCoverages(workspace, coveragestore string) ([]models.Coverage, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages", workspace, coveragestore), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get coverages: %s", string(body))
	}

	var result struct {
		Coverages struct {
			Coverage []models.Coverage `json:"coverage"`
		} `json:"coverages"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode coverages: %w", err)
	}

	for i := range result.Coverages.Coverage {
		result.Coverages.Coverage[i].Workspace = workspace
		result.Coverages.Coverage[i].Store = coveragestore
	}

	return result.Coverages.Coverage, nil
}

// ReloadConfiguration reloads the GeoServer catalog and configuration from disk
func (c *Client) ReloadConfiguration() error {
	resp, err := c.doRequest("POST", "/reload", nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to reload configuration: %s", string(bodyBytes))
	}

	return nil
}

// GetServerVersion fetches the GeoServer version information
func (c *Client) GetServerVersion() (string, error) {
	resp, err := c.doRequest("GET", "/about/version", nil, "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to get version: status %d", resp.StatusCode)
	}

	var result struct {
		About struct {
			Resource []struct {
				Name    string `json:"@name"`
				Version string `json:"Version,omitempty"`
			} `json:"resource"`
		} `json:"about"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode version: %w", err)
	}

	for _, res := range result.About.Resource {
		if res.Name == "GeoServer" {
			return res.Version, nil
		}
	}

	return "unknown", nil
}

// DeleteLayerGroup deletes a layer group
func (c *Client) DeleteLayerGroup(workspace, name string) error {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/layergroups/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/layergroups/%s", workspace, name)
	}

	resp, err := c.doRequest("DELETE", path, nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete layer group: %s", string(bodyBytes))
	}

	return nil
}

// UpdateWorkspace updates a workspace name
func (c *Client) UpdateWorkspace(oldName, newName string) error {
	body := map[string]interface{}{
		"workspace": map[string]string{
			"name": newName,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s", oldName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update workspace: %s", string(bodyBytes))
	}

	return nil
}

// CreateDataStore creates a new data store with connection parameters
func (c *Client) CreateDataStore(workspace string, name string, storeType models.DataStoreType, params map[string]string) error {
	// Build connection parameters in the format GeoServer expects
	// GeoServer JSON format uses "entry" array with "@key" and "$" fields
	entries := make([]map[string]string, 0)

	// Add dbtype for database stores
	if storeType == models.DataStoreTypePostGIS || storeType == models.DataStoreTypeGeoPackage {
		entries = append(entries, map[string]string{
			"@key": "dbtype",
			"$":    storeType.DBType(),
		})
	}

	// Add all provided parameters
	for key, value := range params {
		if key != "name" && value != "" { // Skip name as it's set separately
			entries = append(entries, map[string]string{
				"@key": key,
				"$":    value,
			})
		}
	}

	body := map[string]interface{}{
		"dataStore": map[string]interface{}{
			"name":    name,
			"enabled": true,
			"connectionParameters": map[string]interface{}{
				"entry": entries,
			},
		},
	}

	resp, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/datastores", workspace), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create datastore: %s", string(bodyBytes))
	}

	return nil
}

// UpdateDataStore updates a data store
func (c *Client) UpdateDataStore(workspace, oldName, newName string) error {
	body := map[string]interface{}{
		"dataStore": map[string]string{
			"name": newName,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, oldName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update datastore: %s", string(bodyBytes))
	}

	return nil
}

// CreateCoverageStore creates a new coverage store
func (c *Client) CreateCoverageStore(workspace string, name string, storeType models.CoverageStoreType, url string) error {
	body := map[string]interface{}{
		"coverageStore": map[string]interface{}{
			"name":    name,
			"type":    storeType.Type(),
			"enabled": true,
			"url":     url,
		},
	}

	resp, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/coveragestores", workspace), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create coverage store: %s", string(bodyBytes))
	}

	return nil
}

// UpdateCoverageStore updates a coverage store
func (c *Client) UpdateCoverageStore(workspace, oldName, newName string) error {
	body := map[string]interface{}{
		"coverageStore": map[string]string{
			"name": newName,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, oldName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update coverage store: %s", string(bodyBytes))
	}

	return nil
}

// PublishCoverage publishes a coverage from a coverage store
// This creates a new coverage layer that can be viewed via WMS/WCS
func (c *Client) PublishCoverage(workspace, coverageStore, coverageName string) error {
	// First, get the available coverages in the store to find the native name
	// GeoServer needs us to specify the coverage details
	body := map[string]interface{}{
		"coverage": map[string]interface{}{
			"name":       coverageName,
			"nativeName": coverageName,
			"title":      coverageName,
			"enabled":    true,
			"advertised": true,
		},
	}

	resp, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages", workspace, coverageStore), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to publish coverage: %s", string(bodyBytes))
	}

	return nil
}

// PublishFeatureType publishes a feature type from a data store
// This creates a new layer that can be viewed via WMS/WFS
func (c *Client) PublishFeatureType(workspace, dataStore, featureTypeName string) error {
	body := map[string]interface{}{
		"featureType": map[string]interface{}{
			"name":       featureTypeName,
			"nativeName": featureTypeName,
			"title":      featureTypeName,
			"enabled":    true,
			"advertised": true,
		},
	}

	resp, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes", workspace, dataStore), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to publish feature type: %s", string(bodyBytes))
	}

	return nil
}

// EnableLayer enables or disables a layer
func (c *Client) EnableLayer(workspace, layerName string, enabled bool) error {
	body := map[string]interface{}{
		"layer": map[string]interface{}{
			"enabled": enabled,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/layers/%s:%s", workspace, layerName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update layer: %s", string(bodyBytes))
	}

	return nil
}

// SetLayerAdvertised sets whether a layer is advertised in capabilities documents
func (c *Client) SetLayerAdvertised(workspace, layerName string, advertised bool) error {
	body := map[string]interface{}{
		"layer": map[string]interface{}{
			"advertised": advertised,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/layers/%s:%s", workspace, layerName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update layer: %s", string(bodyBytes))
	}

	return nil
}

// GetWorkspaceConfig retrieves workspace configuration including service settings
func (c *Client) GetWorkspaceConfig(name string) (*models.WorkspaceConfig, error) {
	config := &models.WorkspaceConfig{
		Name: name,
	}

	// Get workspace basic info
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s", name), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get workspace: %s", string(bodyBytes))
	}

	var wsResult struct {
		Workspace struct {
			Name     string `json:"name"`
			Isolated bool   `json:"isolated"`
		} `json:"workspace"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wsResult); err != nil {
		return nil, fmt.Errorf("failed to decode workspace: %w", err)
	}
	config.Isolated = wsResult.Workspace.Isolated

	// Check if this is the default workspace
	defaultWs, err := c.GetDefaultWorkspace()
	if err == nil && defaultWs == name {
		config.Default = true
	}

	// Get workspace settings (enabled)
	settingsResp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/settings", name), nil, "")
	if err == nil {
		defer settingsResp.Body.Close()
		if settingsResp.StatusCode == http.StatusOK {
			var settingsResult struct {
				Settings struct {
					Enabled bool `json:"enabled"`
				} `json:"settings"`
			}
			if json.NewDecoder(settingsResp.Body).Decode(&settingsResult) == nil {
				config.Enabled = settingsResult.Settings.Enabled
			}
		}
	}

	// Get service settings for each service type
	services := []string{"wmts", "wms", "wcs", "wps", "wfs"}
	for _, svc := range services {
		enabled := c.isWorkspaceServiceEnabled(name, svc)
		switch svc {
		case "wmts":
			config.WMTSEnabled = enabled
		case "wms":
			config.WMSEnabled = enabled
		case "wcs":
			config.WCSEnabled = enabled
		case "wps":
			config.WPSEnabled = enabled
		case "wfs":
			config.WFSEnabled = enabled
		}
	}

	return config, nil
}

// GetDefaultWorkspace returns the name of the default workspace
func (c *Client) GetDefaultWorkspace() (string, error) {
	resp, err := c.doRequest("GET", "/workspaces/default", nil, "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("no default workspace set")
	}

	var result struct {
		Workspace struct {
			Name string `json:"name"`
		} `json:"workspace"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.Workspace.Name, nil
}

// SetDefaultWorkspace sets the default workspace
func (c *Client) SetDefaultWorkspace(name string) error {
	body := map[string]interface{}{
		"workspace": map[string]string{
			"name": name,
		},
	}

	resp, err := c.doJSONRequest("PUT", "/workspaces/default", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to set default workspace: %s", string(bodyBytes))
	}

	return nil
}

// isWorkspaceServiceEnabled checks if a service is enabled for a workspace
func (c *Client) isWorkspaceServiceEnabled(workspace, service string) bool {
	resp, err := c.doRequest("GET", fmt.Sprintf("/services/%s/workspaces/%s/settings", service, workspace), nil, "")
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	// If we can get settings, the service is enabled for this workspace
	return true
}

// UpdateWorkspaceSettings updates workspace settings (enabled)
func (c *Client) UpdateWorkspaceSettings(workspace string, enabled bool) error {
	// GeoServer settings body - simpler format
	body := map[string]interface{}{
		"settings": map[string]interface{}{
			"enabled": enabled,
		},
	}

	// First try PUT to update existing settings
	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/settings", workspace), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// If PUT returns 404, the settings don't exist yet - try POST to create them
	if resp.StatusCode == http.StatusNotFound {
		resp2, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/settings", workspace), body)
		if err != nil {
			return err
		}
		defer resp2.Body.Close()

		if resp2.StatusCode != http.StatusOK && resp2.StatusCode != http.StatusCreated {
			bodyBytes, _ := io.ReadAll(resp2.Body)
			return fmt.Errorf("failed to create workspace settings: %s", string(bodyBytes))
		}
		return nil
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update workspace settings: %s", string(bodyBytes))
	}

	return nil
}

// EnableWorkspaceService enables or disables a service for a workspace
func (c *Client) EnableWorkspaceService(workspace, service string, enabled bool) error {
	if enabled {
		// Create service settings for the workspace
		body := map[string]interface{}{
			service: map[string]interface{}{
				"enabled": true,
				"name":    service,
				"workspace": map[string]string{
					"name": workspace,
				},
			},
		}

		resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/services/%s/workspaces/%s/settings", service, workspace), body)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to enable %s for workspace: %s", service, string(bodyBytes))
		}
	} else {
		// Delete service settings for the workspace
		resp, err := c.doRequest("DELETE", fmt.Sprintf("/services/%s/workspaces/%s/settings", service, workspace), nil, "")
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		// 404 is OK - means service was already disabled
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to disable %s for workspace: %s", service, string(bodyBytes))
		}
	}

	return nil
}

// UpdateWorkspaceWithConfig updates a workspace with full configuration
func (c *Client) UpdateWorkspaceWithConfig(oldName string, config models.WorkspaceConfig) error {
	// Update workspace name and isolated status
	wsBody := map[string]interface{}{
		"name": config.Name,
	}
	wsBody["isolated"] = config.Isolated

	body := map[string]interface{}{
		"workspace": wsBody,
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s", oldName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update workspace: %s", string(bodyBytes))
	}

	// Update workspace name for subsequent operations if renamed
	wsName := config.Name

	// Handle default workspace setting
	if config.Default {
		if err := c.SetDefaultWorkspace(wsName); err != nil {
			return fmt.Errorf("failed to set default workspace: %w", err)
		}
	}

	// Update workspace settings (enabled)
	if err := c.UpdateWorkspaceSettings(wsName, config.Enabled); err != nil {
		return fmt.Errorf("failed to update workspace settings: %w", err)
	}

	// Update service settings
	services := map[string]bool{
		"wmts": config.WMTSEnabled,
		"wms":  config.WMSEnabled,
		"wcs":  config.WCSEnabled,
		"wps":  config.WPSEnabled,
		"wfs":  config.WFSEnabled,
	}

	for svc, enabled := range services {
		if err := c.EnableWorkspaceService(wsName, svc, enabled); err != nil {
			return fmt.Errorf("failed to update %s service: %w", svc, err)
		}
	}

	return nil
}

// GetLayerConfig retrieves layer configuration including enabled, advertised, queryable settings
func (c *Client) GetLayerConfig(workspace, layerName string) (*models.LayerConfig, error) {
	config := &models.LayerConfig{
		Name:      layerName,
		Workspace: workspace,
		// Defaults - will be overwritten by resource values
		Enabled:    true,
		Advertised: true,
	}

	// Get layer info to determine resource type and href
	resp, err := c.doRequest("GET", fmt.Sprintf("/layers/%s:%s", workspace, layerName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get layer: %s", string(bodyBytes))
	}

	var layerResult struct {
		Layer struct {
			Name      string `json:"name"`
			Type      string `json:"type"`
			Queryable *bool  `json:"queryable"`
			Resource  struct {
				Class string `json:"@class"`
				Name  string `json:"name"`
				Href  string `json:"href"`
			} `json:"resource"`
			DefaultStyle struct {
				Name string `json:"name"`
			} `json:"defaultStyle"`
		} `json:"layer"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&layerResult); err != nil {
		return nil, fmt.Errorf("failed to decode layer: %w", err)
	}

	if layerResult.Layer.Queryable != nil {
		config.Queryable = *layerResult.Layer.Queryable
	}
	config.DefaultStyle = layerResult.Layer.DefaultStyle.Name

	// Determine store type from resource class
	isFeatureType := layerResult.Layer.Resource.Class == "featureType"
	if isFeatureType {
		config.StoreType = "datastore"
	} else {
		config.StoreType = "coveragestore"
	}

	// Parse the resource href to extract store name
	// Href format: http://host/rest/workspaces/{ws}/datastores/{store}/featuretypes/{name}.json
	// or: http://host/rest/workspaces/{ws}/coveragestores/{store}/coverages/{name}.json
	href := layerResult.Layer.Resource.Href
	config.Store = extractStoreFromHref(href, isFeatureType)

	// Now fetch the resource (featuretype or coverage) to get enabled/advertised
	// These are on the resource, not on the layer endpoint
	if isFeatureType && config.Store != "" {
		resourceResp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes/%s", workspace, config.Store, layerName), nil, "")
		if err == nil {
			defer resourceResp.Body.Close()
			if resourceResp.StatusCode == http.StatusOK {
				var ftResult struct {
					FeatureType struct {
						Enabled    *bool `json:"enabled"`
						Advertised *bool `json:"advertised"`
					} `json:"featureType"`
				}
				if json.NewDecoder(resourceResp.Body).Decode(&ftResult) == nil {
					if ftResult.FeatureType.Enabled != nil {
						config.Enabled = *ftResult.FeatureType.Enabled
					}
					if ftResult.FeatureType.Advertised != nil {
						config.Advertised = *ftResult.FeatureType.Advertised
					}
				}
			}
		}
	} else if !isFeatureType && config.Store != "" {
		resourceResp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages/%s", workspace, config.Store, layerName), nil, "")
		if err == nil {
			defer resourceResp.Body.Close()
			if resourceResp.StatusCode == http.StatusOK {
				var covResult struct {
					Coverage struct {
						Enabled    *bool `json:"enabled"`
						Advertised *bool `json:"advertised"`
					} `json:"coverage"`
				}
				if json.NewDecoder(resourceResp.Body).Decode(&covResult) == nil {
					if covResult.Coverage.Enabled != nil {
						config.Enabled = *covResult.Coverage.Enabled
					}
					if covResult.Coverage.Advertised != nil {
						config.Advertised = *covResult.Coverage.Advertised
					}
				}
			}
		}
	}

	return config, nil
}

// extractStoreFromHref extracts the store name from a resource href
func extractStoreFromHref(href string, isFeatureType bool) string {
	// Href format for featuretype: .../datastores/{store}/featuretypes/...
	// Href format for coverage: .../coveragestores/{store}/coverages/...
	var marker string
	if isFeatureType {
		marker = "/datastores/"
	} else {
		marker = "/coveragestores/"
	}

	idx := strings.Index(href, marker)
	if idx == -1 {
		return ""
	}

	// Get everything after the marker
	remaining := href[idx+len(marker):]

	// Find the next slash
	slashIdx := strings.Index(remaining, "/")
	if slashIdx == -1 {
		return remaining
	}

	return remaining[:slashIdx]
}

// UpdateLayerConfig updates layer configuration
// The enabled and advertised fields are on the resource (featuretype or coverage), not the layer
func (c *Client) UpdateLayerConfig(workspace string, config models.LayerConfig) error {
	// Determine if this is a feature type or coverage based on store type
	isFeatureType := config.StoreType == "datastore"

	// Update the resource (where enabled/advertised are stored)
	if isFeatureType && config.Store != "" {
		body := map[string]interface{}{
			"featureType": map[string]interface{}{
				"enabled":    config.Enabled,
				"advertised": config.Advertised,
			},
		}

		resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes/%s", workspace, config.Store, config.Name), body)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to update feature type: %s", string(bodyBytes))
		}
	} else if !isFeatureType && config.Store != "" {
		body := map[string]interface{}{
			"coverage": map[string]interface{}{
				"enabled":    config.Enabled,
				"advertised": config.Advertised,
			},
		}

		resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages/%s", workspace, config.Store, config.Name), body)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to update coverage: %s", string(bodyBytes))
		}
	} else {
		return fmt.Errorf("cannot update layer: store name is required")
	}

	// Update queryable on the layer endpoint (only for vector layers)
	if isFeatureType {
		layerBody := map[string]interface{}{
			"layer": map[string]interface{}{
				"queryable": config.Queryable,
			},
		}

		resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/layers/%s:%s", workspace, config.Name), layerBody)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		// Non-OK status is acceptable here as queryable might not be supported
	}

	return nil
}

// GetDataStoreConfig retrieves data store configuration
func (c *Client) GetDataStoreConfig(workspace, storeName string) (*models.DataStoreConfig, error) {
	config := &models.DataStoreConfig{
		Name:      storeName,
		Workspace: workspace,
	}

	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, storeName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get data store: %s", string(bodyBytes))
	}

	var storeResult struct {
		DataStore struct {
			Name        string `json:"name"`
			Enabled     bool   `json:"enabled"`
			Description string `json:"description"`
		} `json:"dataStore"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&storeResult); err != nil {
		return nil, fmt.Errorf("failed to decode data store: %w", err)
	}

	config.Enabled = storeResult.DataStore.Enabled
	config.Description = storeResult.DataStore.Description

	return config, nil
}

// UpdateDataStoreConfig updates data store configuration
func (c *Client) UpdateDataStoreConfig(workspace string, config models.DataStoreConfig) error {
	body := map[string]interface{}{
		"dataStore": map[string]interface{}{
			"name":        config.Name,
			"enabled":     config.Enabled,
			"description": config.Description,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, config.Name), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update data store: %s", string(bodyBytes))
	}

	return nil
}

// GetCoverageStoreConfig retrieves coverage store configuration
func (c *Client) GetCoverageStoreConfig(workspace, storeName string) (*models.CoverageStoreConfig, error) {
	config := &models.CoverageStoreConfig{
		Name:      storeName,
		Workspace: workspace,
	}

	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, storeName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get coverage store: %s", string(bodyBytes))
	}

	var storeResult struct {
		CoverageStore struct {
			Name        string `json:"name"`
			Enabled     bool   `json:"enabled"`
			Description string `json:"description"`
		} `json:"coverageStore"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&storeResult); err != nil {
		return nil, fmt.Errorf("failed to decode coverage store: %w", err)
	}

	config.Enabled = storeResult.CoverageStore.Enabled
	config.Description = storeResult.CoverageStore.Description

	return config, nil
}

// UpdateCoverageStoreConfig updates coverage store configuration
func (c *Client) UpdateCoverageStoreConfig(workspace string, config models.CoverageStoreConfig) error {
	body := map[string]interface{}{
		"coverageStore": map[string]interface{}{
			"name":        config.Name,
			"enabled":     config.Enabled,
			"description": config.Description,
		},
	}

	resp, err := c.doJSONRequest("PUT", fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, config.Name), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update coverage store: %s", string(bodyBytes))
	}

	return nil
}
