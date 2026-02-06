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

	var result struct {
		Workspaces struct {
			Workspace []models.Workspace `json:"workspace"`
		} `json:"workspaces"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
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

	for i := range result.DataStores.DataStore {
		result.DataStores.DataStore[i].Workspace = workspace
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

	for i := range result.CoverageStores.CoverageStore {
		result.CoverageStores.CoverageStore[i].Workspace = workspace
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

// CreateWorkspace creates a new workspace
func (c *Client) CreateWorkspace(name string) error {
	body := map[string]interface{}{
		"workspace": map[string]string{
			"name": name,
		},
	}

	resp, err := c.doJSONRequest("POST", "/workspaces", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create workspace: %s", string(bodyBytes))
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
