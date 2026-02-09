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
	"regexp"
	"strings"
	"time"

	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// fixEmptyGeoServerResponse handles GeoServer's quirk of returning "" instead of {} or []
// for empty collections. This converts patterns like {"dataStores": ""} to {"dataStores": {}}
func fixEmptyGeoServerResponse(body []byte) []byte {
	// Pattern matches: "someKey": "" where the value is an empty string
	// and converts it to "someKey": {} to allow proper unmarshaling
	re := regexp.MustCompile(`("(?:dataStores|coverageStores|wmsStores|wmtsStores|styles|layers|layerGroups|featureTypes|coverages|workspaces)")\s*:\s*""`)
	return re.ReplaceAll(body, []byte(`$1: {}`))
}

// Client is a GeoServer REST API client
type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
}

// NewClient creates a new GeoServer API client from a Connection
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

// NewClientDirect creates a new GeoServer API client with direct parameters
func NewClientDirect(baseURL, username, password string) *Client {
	return &Client{
		baseURL:  strings.TrimSuffix(baseURL, "/"),
		username: username,
		password: password,
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

// ServerStatus contains runtime status information
type ServerStatus struct {
	Online          bool    `json:"online"`
	ResponseTimeMs  int64   `json:"responseTimeMs"`
	MemoryUsed      int64   `json:"memoryUsed"`      // bytes
	MemoryFree      int64   `json:"memoryFree"`      // bytes
	MemoryTotal     int64   `json:"memoryTotal"`     // bytes
	MemoryUsedPct   float64 `json:"memoryUsedPct"`   // percentage
	CPULoad         float64 `json:"cpuLoad"`         // percentage (if available)
	WorkspaceCount  int     `json:"workspaceCount"`
	LayerCount      int     `json:"layerCount"`
	DataStoreCount  int     `json:"dataStoreCount"`
	CoverageCount   int     `json:"coverageCount"`
	StyleCount      int     `json:"styleCount"`
	Error           string  `json:"error,omitempty"`
	GeoServerVersion string `json:"geoserverVersion,omitempty"`
}

// GetServerStatus fetches the runtime status of the GeoServer instance
func (c *Client) GetServerStatus() (*ServerStatus, error) {
	startTime := time.Now()
	status := &ServerStatus{Online: false}

	// First check if server is reachable
	resp, err := c.doRequest("GET", "/about/status", nil, "")
	if err != nil {
		status.Error = fmt.Sprintf("Connection failed: %v", err)
		return status, nil
	}
	defer resp.Body.Close()

	status.ResponseTimeMs = time.Since(startTime).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		status.Error = fmt.Sprintf("Status check failed: %s", string(body))
		return status, nil
	}

	status.Online = true

	// Parse status response for memory info
	var statusResp struct {
		About struct {
			Status []struct {
				Name  string `json:"@name"`
				Value string `json:"value"`
			} `json:"status"`
		} `json:"about"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&statusResp); err == nil {
		for _, s := range statusResp.About.Status {
			switch s.Name {
			case "GEOSERVER_DATA_DIR":
				// data dir info
			}
		}
	}

	// Get memory info from system status endpoint
	memResp, err := c.doRequest("GET", "/about/system-status", nil, "")
	if err == nil {
		defer memResp.Body.Close()
		if memResp.StatusCode == http.StatusOK {
			var sysStatus struct {
				Metrics struct {
					Metric []struct {
						Name      string `json:"@name"`
						Available bool   `json:"available"`
						Value     string `json:"value"`
						Unit      string `json:"unit,omitempty"`
					} `json:"metric"`
				} `json:"metrics"`
			}
			if err := json.NewDecoder(memResp.Body).Decode(&sysStatus); err == nil {
				for _, m := range sysStatus.Metrics.Metric {
					if !m.Available {
						continue
					}
					switch m.Name {
					case "MEMORY_USED":
						fmt.Sscanf(m.Value, "%d", &status.MemoryUsed)
					case "MEMORY_FREE":
						fmt.Sscanf(m.Value, "%d", &status.MemoryFree)
					case "MEMORY_TOTAL":
						fmt.Sscanf(m.Value, "%d", &status.MemoryTotal)
					case "CPU_LOAD":
						fmt.Sscanf(m.Value, "%f", &status.CPULoad)
					}
				}
				if status.MemoryTotal > 0 {
					status.MemoryUsedPct = float64(status.MemoryUsed) / float64(status.MemoryTotal) * 100
				}
			}
		}
	}

	// Get version info
	if info, err := c.GetServerInfo(); err == nil {
		status.GeoServerVersion = info.GeoServerVersion
	}

	return status, nil
}

// GetServerCounts fetches counts of various resources
func (c *Client) GetServerCounts() (*ServerStatus, error) {
	status := &ServerStatus{Online: true}

	// Count workspaces
	if workspaces, err := c.GetWorkspaces(); err == nil {
		status.WorkspaceCount = len(workspaces)

		// Count layers, stores across all workspaces
		for _, ws := range workspaces {
			if layers, err := c.GetLayers(ws.Name); err == nil {
				status.LayerCount += len(layers)
			}
			if stores, err := c.GetDataStores(ws.Name); err == nil {
				status.DataStoreCount += len(stores)
			}
			if coverages, err := c.GetCoverageStores(ws.Name); err == nil {
				status.CoverageCount += len(coverages)
			}
		}
	}

	// Count global styles
	if styles, err := c.GetStyles(""); err == nil {
		status.StyleCount = len(styles)
	}

	return status, nil
}

// GetFullServerStatus gets both runtime status and resource counts
func (c *Client) GetFullServerStatus() (*ServerStatus, error) {
	status, err := c.GetServerStatus()
	if err != nil || !status.Online {
		return status, err
	}

	// Get resource counts
	counts, _ := c.GetServerCounts()
	if counts != nil {
		status.WorkspaceCount = counts.WorkspaceCount
		status.LayerCount = counts.LayerCount
		status.DataStoreCount = counts.DataStoreCount
		status.CoverageCount = counts.CoverageCount
		status.StyleCount = counts.StyleCount
	}

	return status, nil
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Fix GeoServer's empty string response quirk
	body = fixEmptyGeoServerResponse(body)

	var result struct {
		DataStores struct {
			DataStore []models.DataStore `json:"dataStore"`
		} `json:"dataStores"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Fix GeoServer's empty string response quirk
	body = fixEmptyGeoServerResponse(body)

	var result struct {
		CoverageStores struct {
			CoverageStore []models.CoverageStore `json:"coverageStore"`
		} `json:"coverageStores"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Fix GeoServer's empty string response quirk
	body = fixEmptyGeoServerResponse(body)

	var result struct {
		Layers struct {
			Layer []models.Layer `json:"layer"`
		} `json:"layers"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Fix GeoServer's empty string response quirk
	body = fixEmptyGeoServerResponse(body)

	var result struct {
		Styles struct {
			Style []models.Style `json:"style"`
		} `json:"styles"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode styles: %w", err)
	}

	for i := range result.Styles.Style {
		result.Styles.Style[i].Workspace = workspace
	}

	return result.Styles.Style, nil
}

// GetStyleSLD fetches the SLD content of a style
func (c *Client) GetStyleSLD(workspace, styleName string) (string, error) {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/styles/%s.sld", styleName)
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles/%s.sld", workspace, styleName)
	}

	url := c.baseURL + "/rest" + path
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", "application/vnd.ogc.sld+xml")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to get style SLD: %s", string(body))
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read style content: %w", err)
	}

	return string(content), nil
}

// CreateOrUpdateStyle creates or updates a style with SLD content
func (c *Client) CreateOrUpdateStyle(workspace, styleName, sldContent string) error {
	var basePath string
	if workspace == "" {
		basePath = "/styles"
	} else {
		basePath = fmt.Sprintf("/workspaces/%s/styles", workspace)
	}

	// First, try to check if the style exists
	checkPath := basePath + "/" + styleName
	checkResp, err := c.doRequest("GET", checkPath, nil, "")
	if err != nil {
		return err
	}
	checkResp.Body.Close()

	if checkResp.StatusCode == http.StatusOK {
		// Style exists, update it
		updatePath := basePath + "/" + styleName
		url := c.baseURL + "/rest" + updatePath
		req, err := http.NewRequest("PUT", url, strings.NewReader(sldContent))
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.SetBasicAuth(c.username, c.password)
		req.Header.Set("Content-Type", "application/vnd.ogc.sld+xml")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to update style: %s", string(body))
		}
		return nil
	}

	// Style doesn't exist, create it
	// First create the style definition
	styleBody := map[string]interface{}{
		"style": map[string]interface{}{
			"name":     styleName,
			"filename": styleName + ".sld",
		},
	}
	resp, err := c.doJSONRequest("POST", basePath, styleBody)
	if err != nil {
		return err
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to create style definition: status %d", resp.StatusCode)
	}

	// Now upload the SLD content
	uploadPath := basePath + "/" + styleName
	url := c.baseURL + "/rest" + uploadPath
	req, err := http.NewRequest("PUT", url, strings.NewReader(sldContent))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/vnd.ogc.sld+xml")

	uploadResp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer uploadResp.Body.Close()

	if uploadResp.StatusCode != http.StatusOK && uploadResp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(uploadResp.Body)
		return fmt.Errorf("failed to upload style content: %s", string(body))
	}

	return nil
}

// GetStyleContent fetches the content of a style (SLD or CSS)
func (c *Client) GetStyleContent(workspace, styleName, format string) (string, error) {
	var path string
	var extension string
	var acceptHeader string

	switch format {
	case "css":
		extension = ".css"
		acceptHeader = "application/vnd.geoserver.geocss+css"
	case "mbstyle":
		extension = ".json"
		acceptHeader = "application/vnd.geoserver.mbstyle+json"
	default: // sld
		extension = ".sld"
		acceptHeader = "application/vnd.ogc.sld+xml"
	}

	if workspace == "" {
		path = fmt.Sprintf("/styles/%s%s", styleName, extension)
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles/%s%s", workspace, styleName, extension)
	}

	url := c.baseURL + "/rest" + path
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", acceptHeader)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("failed to get style content: %s", string(body))
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read style content: %w", err)
	}

	return string(content), nil
}

// UpdateStyleContent updates the content of an existing style
func (c *Client) UpdateStyleContent(workspace, styleName, content, format string) error {
	var path string
	var contentType string

	switch format {
	case "css":
		contentType = "application/vnd.geoserver.geocss+css"
	case "mbstyle":
		contentType = "application/vnd.geoserver.mbstyle+json"
	default: // sld
		contentType = "application/vnd.ogc.sld+xml"
	}

	if workspace == "" {
		path = fmt.Sprintf("/styles/%s", styleName)
	} else {
		path = fmt.Sprintf("/workspaces/%s/styles/%s", workspace, styleName)
	}

	url := c.baseURL + "/rest" + path
	req, err := http.NewRequest("PUT", url, strings.NewReader(content))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", contentType)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update style: %s", string(body))
	}

	return nil
}

// CreateStyle creates a new style with content
func (c *Client) CreateStyle(workspace, styleName, content, format string) error {
	var basePath string
	var contentType string
	var extension string

	switch format {
	case "css":
		contentType = "application/vnd.geoserver.geocss+css"
		extension = ".css"
	case "mbstyle":
		contentType = "application/vnd.geoserver.mbstyle+json"
		extension = ".json"
	default: // sld
		contentType = "application/vnd.ogc.sld+xml"
		extension = ".sld"
	}

	if workspace == "" {
		basePath = "/styles"
	} else {
		basePath = fmt.Sprintf("/workspaces/%s/styles", workspace)
	}

	// First create the style definition
	styleBody := map[string]interface{}{
		"style": map[string]interface{}{
			"name":     styleName,
			"filename": styleName + extension,
		},
	}
	resp, err := c.doJSONRequest("POST", basePath, styleBody)
	if err != nil {
		return err
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to create style definition: status %d", resp.StatusCode)
	}

	// Now upload the style content
	uploadPath := basePath + "/" + styleName
	url := c.baseURL + "/rest" + uploadPath
	req, err := http.NewRequest("PUT", url, strings.NewReader(content))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", contentType)

	uploadResp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer uploadResp.Body.Close()

	if uploadResp.StatusCode != http.StatusOK && uploadResp.StatusCode != http.StatusCreated && uploadResp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(uploadResp.Body)
		return fmt.Errorf("failed to upload style content: %s", string(body))
	}

	return nil
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Fix GeoServer's empty string response quirk
	body = fixEmptyGeoServerResponse(body)

	var result struct {
		LayerGroups struct {
			LayerGroup []models.LayerGroup `json:"layerGroup"`
		} `json:"layerGroups"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to decode layer groups: %w", err)
	}

	for i := range result.LayerGroups.LayerGroup {
		result.LayerGroups.LayerGroup[i].Workspace = workspace
	}

	return result.LayerGroups.LayerGroup, nil
}

// CreateLayerGroup creates a new layer group in a workspace
func (c *Client) CreateLayerGroup(workspace string, config models.LayerGroupCreate) error {
	path := fmt.Sprintf("/workspaces/%s/layergroups", workspace)

	// Build the publishables array with layer references
	publishables := make([]map[string]interface{}, len(config.Layers))
	styles := make([]map[string]interface{}, len(config.Layers))

	for i, layerName := range config.Layers {
		// Layer names should be in workspace:layer format
		publishables[i] = map[string]interface{}{
			"@type": "layer",
			"name":  layerName,
		}
		// Use empty style (default) for each layer
		styles[i] = map[string]interface{}{}
	}

	mode := config.Mode
	if mode == "" {
		mode = "SINGLE"
	}

	body := map[string]interface{}{
		"layerGroup": map[string]interface{}{
			"name": config.Name,
			"mode": mode,
			"publishables": map[string]interface{}{
				"published": publishables,
			},
			"styles": map[string]interface{}{
				"style": styles,
			},
		},
	}

	if config.Title != "" {
		body["layerGroup"].(map[string]interface{})["title"] = config.Title
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to marshal layer group: %w", err)
	}

	resp, err := c.doRequest("POST", path, bytes.NewReader(jsonBody), "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 && resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create layer group (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
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

// parseOWSException extracts a human-readable error message from OWS/OGC XML exception responses
func parseOWSException(data []byte, fallbackPrefix string) error {
	content := string(data)

	// Common error patterns and their user-friendly messages
	errorMappings := map[string]string{
		"idle-session timeout":           "The database connection timed out. Please try again.",
		"terminating connection":         "The database connection was lost. Please try again.",
		"Could not find layer":           "Layer not found. It may have been deleted or renamed.",
		"No such feature type":           "This layer type cannot be downloaded as a shapefile.",
		"Feature type not found":         "Layer not found on the server.",
		"Unknown coverage":               "Coverage not found on the server.",
		"InvalidParameterValue":          "Invalid request parameters.",
		"MissingParameterValue":          "Missing required parameters.",
		"OperationNotSupported":          "This operation is not supported for this layer.",
		"java.lang.OutOfMemoryError":     "The server ran out of memory. The dataset may be too large to download.",
		"Connection refused":             "Cannot connect to the database server.",
		"authentication failed":          "Database authentication failed.",
		"does not exist":                 "The requested resource does not exist.",
		"permission denied":              "Permission denied. Check your credentials.",
		"WFS is not enabled":             "WFS service is not enabled for this layer.",
		"WCS is not enabled":             "WCS service is not enabled for this coverage.",
	}

	// Check for known error patterns
	for pattern, message := range errorMappings {
		if strings.Contains(strings.ToLower(content), strings.ToLower(pattern)) {
			return fmt.Errorf("%s", message)
		}
	}

	// Try to extract ExceptionText from OWS XML
	if strings.Contains(content, "ExceptionText") {
		start := strings.Index(content, "<ows:ExceptionText>")
		if start == -1 {
			start = strings.Index(content, "<ExceptionText>")
		}
		if start != -1 {
			// Find the text content
			textStart := strings.Index(content[start:], ">") + start + 1
			end := strings.Index(content[textStart:], "</")
			if end != -1 {
				exceptionText := content[textStart : textStart+end]
				// Clean up the exception text
				exceptionText = strings.ReplaceAll(exceptionText, "\n", " ")
				exceptionText = strings.TrimSpace(exceptionText)
				// Truncate if too long
				if len(exceptionText) > 200 {
					exceptionText = exceptionText[:200] + "..."
				}
				return fmt.Errorf("%s: %s", fallbackPrefix, exceptionText)
			}
		}
	}

	// Fallback: just return a generic message
	return fmt.Errorf("%s: Server returned an error. Please check the layer configuration.", fallbackPrefix)
}

// DownloadLayerAsShapefile downloads a layer's data via WFS as a zipped shapefile
// Returns the shapefile data as bytes
func (c *Client) DownloadLayerAsShapefile(workspace, layerName string) ([]byte, error) {
	// Build WFS GetFeature URL with SHAPE-ZIP output format
	wfsURL := fmt.Sprintf("%s/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=%s:%s&outputFormat=SHAPE-ZIP",
		c.baseURL, workspace, layerName)

	req, err := http.NewRequest("GET", wfsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("WFS request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, parseOWSException(bodyBytes, fmt.Sprintf("WFS request failed (%d)", resp.StatusCode))
	}

	// Check content type - GeoServer returns application/xml for errors even with 200 OK
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "xml") || strings.Contains(contentType, "text/") {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, parseOWSException(bodyBytes, "WFS download failed")
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Verify we got a ZIP file (first 2 bytes should be PK)
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return nil, parseOWSException(data, "Invalid shapefile response")
	}

	return data, nil
}

// UploadShapefileData uploads shapefile data (as zipped bytes) to create a datastore
func (c *Client) UploadShapefileData(workspace, storeName string, data []byte) error {
	path := fmt.Sprintf("/workspaces/%s/datastores/%s/file.shp", workspace, storeName)

	req, err := http.NewRequest("PUT", c.baseURL+"/rest"+path, bytes.NewReader(data))
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
		return fmt.Errorf("upload failed (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

// DownloadCoverageAsGeoTIFF downloads a coverage via WCS as GeoTIFF
// Returns the GeoTIFF data as bytes
func (c *Client) DownloadCoverageAsGeoTIFF(workspace, coverageName string) ([]byte, error) {
	// Build WCS GetCoverage URL - use workspace__coveragename format for CoverageId
	wcsURL := fmt.Sprintf("%s/wcs?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=%s__%s&format=image/geotiff",
		c.baseURL, workspace, coverageName)

	req, err := http.NewRequest("GET", wcsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.username, c.password)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("WCS request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, parseOWSException(bodyBytes, fmt.Sprintf("WCS request failed (%d)", resp.StatusCode))
	}

	// Check content type - GeoServer returns application/xml for errors even with 200 OK
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "xml") || strings.Contains(contentType, "text/") {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, parseOWSException(bodyBytes, "WCS download failed")
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Verify we got a TIFF file (first 2 bytes should be II or MM for little/big endian)
	if len(data) < 4 || !((data[0] == 'I' && data[1] == 'I') || (data[0] == 'M' && data[1] == 'M')) {
		return nil, parseOWSException(data, "Invalid GeoTIFF response")
	}

	return data, nil
}

// UploadGeoTIFFData uploads GeoTIFF data to create a coverage store
func (c *Client) UploadGeoTIFFData(workspace, storeName string, data []byte) error {
	path := fmt.Sprintf("/workspaces/%s/coveragestores/%s/file.geotiff", workspace, storeName)

	req, err := http.NewRequest("PUT", c.baseURL+"/rest"+path, bytes.NewReader(data))
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
		return fmt.Errorf("upload failed (%d): %s", resp.StatusCode, string(bodyBytes))
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

// GetAvailableFeatureTypes fetches unpublished feature types for a datastore
// This returns feature types that exist in the data source but haven't been published yet
func (c *Client) GetAvailableFeatureTypes(workspace, datastore string) ([]string, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes?list=available", workspace, datastore), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get available feature types: %s", string(body))
	}

	var result struct {
		List struct {
			String []string `json:"string"`
		} `json:"list"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode available feature types: %w", err)
	}

	return result.List.String, nil
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

// GetLayerGroup fetches details for a specific layer group
func (c *Client) GetLayerGroup(workspace, name string) (*models.LayerGroupDetails, error) {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/layergroups/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/layergroups/%s", workspace, name)
	}

	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get layer group: %s", string(bodyBytes))
	}

	var result struct {
		LayerGroup struct {
			Name       string `json:"name"`
			Mode       string `json:"mode"`
			Title      string `json:"title"`
			Abstract   string `json:"abstractTxt"`
			Workspace  struct {
				Name string `json:"name"`
			} `json:"workspace"`
			Publishables struct {
				Published []struct {
					Type string `json:"@type"`
					Name string `json:"name"`
				} `json:"published"`
			} `json:"publishables"`
			Styles struct {
				Style []struct {
					Name string `json:"name"`
				} `json:"style"`
			} `json:"styles"`
			Bounds struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
				CRS  string  `json:"crs"`
			} `json:"bounds"`
		} `json:"layerGroup"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode layer group: %w", err)
	}

	details := &models.LayerGroupDetails{
		Name:       result.LayerGroup.Name,
		Mode:       result.LayerGroup.Mode,
		Title:      result.LayerGroup.Title,
		Abstract:   result.LayerGroup.Abstract,
		Workspace:  result.LayerGroup.Workspace.Name,
		Enabled:    true, // Layer groups are enabled by default
		Advertised: true,
	}

	// Parse layers
	for i, pub := range result.LayerGroup.Publishables.Published {
		item := models.LayerGroupItem{
			Type: pub.Type,
			Name: pub.Name,
		}
		// Match with style if available
		if i < len(result.LayerGroup.Styles.Style) {
			item.StyleName = result.LayerGroup.Styles.Style[i].Name
		}
		details.Layers = append(details.Layers, item)
	}

	// Parse bounds
	if result.LayerGroup.Bounds.CRS != "" {
		details.Bounds = &models.Bounds{
			MinX: result.LayerGroup.Bounds.MinX,
			MinY: result.LayerGroup.Bounds.MinY,
			MaxX: result.LayerGroup.Bounds.MaxX,
			MaxY: result.LayerGroup.Bounds.MaxY,
			CRS:  result.LayerGroup.Bounds.CRS,
		}
	}

	return details, nil
}

// UpdateLayerGroup updates an existing layer group
func (c *Client) UpdateLayerGroup(workspace, name string, update models.LayerGroupUpdate) error {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/layergroups/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/layergroups/%s", workspace, name)
	}

	// Build the publishables array with layer references
	publishables := make([]map[string]interface{}, len(update.Layers))
	styles := make([]map[string]interface{}, len(update.Layers))

	for i, layerName := range update.Layers {
		publishables[i] = map[string]interface{}{
			"@type": "layer",
			"name":  layerName,
		}
		// Use empty style (default) for each layer
		styles[i] = map[string]interface{}{}
	}

	body := map[string]interface{}{
		"layerGroup": map[string]interface{}{
			"mode": update.Mode,
		},
	}

	lg := body["layerGroup"].(map[string]interface{})

	if update.Title != "" {
		lg["title"] = update.Title
	}

	if len(update.Layers) > 0 {
		lg["publishables"] = map[string]interface{}{
			"published": publishables,
		}
		lg["styles"] = map[string]interface{}{
			"style": styles,
		}
	}

	resp, err := c.doJSONRequest("PUT", path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update layer group: %s", string(bodyBytes))
	}

	return nil
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

// DataStoreDetails contains full datastore configuration for syncing
type DataStoreDetails struct {
	Name                 string            `json:"name"`
	Description          string            `json:"description,omitempty"`
	Type                 string            `json:"type"`
	Enabled              bool              `json:"enabled"`
	ConnectionParameters map[string]string `json:"connectionParameters"`
}

// GetDataStoreDetails retrieves full data store configuration including connection parameters
func (c *Client) GetDataStoreDetails(workspace, storeName string) (*DataStoreDetails, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, storeName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get data store details: %s", string(bodyBytes))
	}

	var storeResult struct {
		DataStore struct {
			Name                 string `json:"name"`
			Description          string `json:"description"`
			Type                 string `json:"type"`
			Enabled              bool   `json:"enabled"`
			ConnectionParameters struct {
				Entry []struct {
					Key   string `json:"@key"`
					Value string `json:"$"`
				} `json:"entry"`
			} `json:"connectionParameters"`
		} `json:"dataStore"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&storeResult); err != nil {
		return nil, fmt.Errorf("failed to decode data store details: %w", err)
	}

	details := &DataStoreDetails{
		Name:                 storeResult.DataStore.Name,
		Description:          storeResult.DataStore.Description,
		Type:                 storeResult.DataStore.Type,
		Enabled:              storeResult.DataStore.Enabled,
		ConnectionParameters: make(map[string]string),
	}

	// Convert entry array to map
	for _, entry := range storeResult.DataStore.ConnectionParameters.Entry {
		details.ConnectionParameters[entry.Key] = entry.Value
	}

	return details, nil
}

// CreateDataStoreFromDetails creates a data store using full configuration details
func (c *Client) CreateDataStoreFromDetails(workspace string, details *DataStoreDetails) error {
	// Convert connection parameters map back to entry array format
	entries := make([]map[string]string, 0, len(details.ConnectionParameters))
	for key, value := range details.ConnectionParameters {
		entries = append(entries, map[string]string{
			"@key": key,
			"$":    value,
		})
	}

	body := map[string]interface{}{
		"dataStore": map[string]interface{}{
			"name":        details.Name,
			"description": details.Description,
			"type":        details.Type,
			"enabled":     details.Enabled,
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

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create data store: %s", string(bodyBytes))
	}

	return nil
}

// CoverageStoreDetails contains full coverage store configuration for syncing
type CoverageStoreDetails struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type"`
	Enabled     bool   `json:"enabled"`
	URL         string `json:"url"`
}

// GetCoverageStoreDetails retrieves full coverage store details including URL and type
func (c *Client) GetCoverageStoreDetails(workspace, storeName string) (*CoverageStoreDetails, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, storeName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get coverage store details: %s", string(bodyBytes))
	}

	var storeResult struct {
		CoverageStore struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Type        string `json:"type"`
			Enabled     bool   `json:"enabled"`
			URL         string `json:"url"`
		} `json:"coverageStore"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&storeResult); err != nil {
		return nil, fmt.Errorf("failed to decode coverage store details: %w", err)
	}

	return &CoverageStoreDetails{
		Name:        storeResult.CoverageStore.Name,
		Description: storeResult.CoverageStore.Description,
		Type:        storeResult.CoverageStore.Type,
		Enabled:     storeResult.CoverageStore.Enabled,
		URL:         storeResult.CoverageStore.URL,
	}, nil
}

// CreateCoverageStoreFromDetails creates a coverage store using full configuration details
func (c *Client) CreateCoverageStoreFromDetails(workspace string, details *CoverageStoreDetails) error {
	body := map[string]interface{}{
		"coverageStore": map[string]interface{}{
			"name":        details.Name,
			"description": details.Description,
			"type":        details.Type,
			"enabled":     details.Enabled,
			"url":         details.URL,
		},
	}

	resp, err := c.doJSONRequest("POST", fmt.Sprintf("/workspaces/%s/coveragestores", workspace), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to create coverage store: %s", string(bodyBytes))
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

// GetLayerMetadata retrieves comprehensive layer metadata
func (c *Client) GetLayerMetadata(workspace, layerName string) (*models.LayerMetadata, error) {
	metadata := &models.LayerMetadata{
		Name:      layerName,
		Workspace: workspace,
	}

	// Get layer info to determine resource type
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
		metadata.Queryable = *layerResult.Layer.Queryable
	}
	metadata.DefaultStyle = layerResult.Layer.DefaultStyle.Name

	// Determine if featuretype or coverage
	isFeatureType := strings.Contains(layerResult.Layer.Resource.Class, "FeatureType")

	// Extract store name from href
	storeName := c.extractStoreNameFromHref(layerResult.Layer.Resource.Href, isFeatureType)
	metadata.Store = storeName
	if isFeatureType {
		metadata.StoreType = "datastore"
	} else {
		metadata.StoreType = "coveragestore"
	}

	// Get resource details (featuretype or coverage)
	var resourcePath string
	if isFeatureType {
		resourcePath = fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes/%s", workspace, storeName, layerName)
	} else {
		resourcePath = fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages/%s", workspace, storeName, layerName)
	}

	resourceResp, err := c.doRequest("GET", resourcePath, nil, "")
	if err != nil {
		return metadata, nil // Return what we have
	}
	defer resourceResp.Body.Close()

	if resourceResp.StatusCode != http.StatusOK {
		return metadata, nil // Return what we have
	}

	if isFeatureType {
		var ftResult struct {
			FeatureType struct {
				Name       string `json:"name"`
				NativeName string `json:"nativeName"`
				Title      string `json:"title"`
				Abstract   string `json:"abstract"`
				Keywords   struct {
					String []string `json:"string"`
				} `json:"keywords"`
				NativeCRS string `json:"nativeCRS"`
				SRS       string `json:"srs"`
				Enabled   bool   `json:"enabled"`
				Advertised bool  `json:"advertised"`
				NativeBoundingBox struct {
					MinX float64 `json:"minx"`
					MinY float64 `json:"miny"`
					MaxX float64 `json:"maxx"`
					MaxY float64 `json:"maxy"`
					CRS  string  `json:"crs"`
				} `json:"nativeBoundingBox"`
				LatLonBoundingBox struct {
					MinX float64 `json:"minx"`
					MinY float64 `json:"miny"`
					MaxX float64 `json:"maxx"`
					MaxY float64 `json:"maxy"`
					CRS  string  `json:"crs"`
				} `json:"latLonBoundingBox"`
				MaxFeatures  int  `json:"maxFeatures"`
				NumDecimals  int  `json:"numDecimals"`
				MetadataLinks struct {
					MetadataLink []struct {
						Type         string `json:"type"`
						MetadataType string `json:"metadataType"`
						Content      string `json:"content"`
					} `json:"metadataLink"`
				} `json:"metadataLinks"`
			} `json:"featureType"`
		}

		if err := json.NewDecoder(resourceResp.Body).Decode(&ftResult); err == nil {
			ft := ftResult.FeatureType
			metadata.NativeName = ft.NativeName
			metadata.Title = ft.Title
			metadata.Abstract = ft.Abstract
			metadata.Keywords = ft.Keywords.String
			metadata.NativeCRS = ft.NativeCRS
			metadata.SRS = ft.SRS
			metadata.Enabled = ft.Enabled
			metadata.Advertised = ft.Advertised
			metadata.MaxFeatures = ft.MaxFeatures
			metadata.NumDecimals = ft.NumDecimals
			metadata.NativeBoundingBox = &models.BoundingBox{
				MinX: ft.NativeBoundingBox.MinX,
				MinY: ft.NativeBoundingBox.MinY,
				MaxX: ft.NativeBoundingBox.MaxX,
				MaxY: ft.NativeBoundingBox.MaxY,
				CRS:  ft.NativeBoundingBox.CRS,
			}
			metadata.LatLonBoundingBox = &models.BoundingBox{
				MinX: ft.LatLonBoundingBox.MinX,
				MinY: ft.LatLonBoundingBox.MinY,
				MaxX: ft.LatLonBoundingBox.MaxX,
				MaxY: ft.LatLonBoundingBox.MaxY,
				CRS:  ft.LatLonBoundingBox.CRS,
			}
			for _, ml := range ft.MetadataLinks.MetadataLink {
				metadata.MetadataLinks = append(metadata.MetadataLinks, models.MetadataLink{
					Type:         ml.Type,
					MetadataType: ml.MetadataType,
					Content:      ml.Content,
				})
			}
		}
	} else {
		var covResult struct {
			Coverage struct {
				Name       string `json:"name"`
				NativeName string `json:"nativeName"`
				Title      string `json:"title"`
				Abstract   string `json:"abstract"`
				Keywords   struct {
					String []string `json:"string"`
				} `json:"keywords"`
				NativeCRS string `json:"nativeCRS"`
				SRS       string `json:"srs"`
				Enabled   bool   `json:"enabled"`
				Advertised bool  `json:"advertised"`
				NativeBoundingBox struct {
					MinX float64 `json:"minx"`
					MinY float64 `json:"miny"`
					MaxX float64 `json:"maxx"`
					MaxY float64 `json:"maxy"`
					CRS  string  `json:"crs"`
				} `json:"nativeBoundingBox"`
				LatLonBoundingBox struct {
					MinX float64 `json:"minx"`
					MinY float64 `json:"miny"`
					MaxX float64 `json:"maxx"`
					MaxY float64 `json:"maxy"`
					CRS  string  `json:"crs"`
				} `json:"latLonBoundingBox"`
			} `json:"coverage"`
		}

		if err := json.NewDecoder(resourceResp.Body).Decode(&covResult); err == nil {
			cov := covResult.Coverage
			metadata.NativeName = cov.NativeName
			metadata.Title = cov.Title
			metadata.Abstract = cov.Abstract
			metadata.Keywords = cov.Keywords.String
			metadata.NativeCRS = cov.NativeCRS
			metadata.SRS = cov.SRS
			metadata.Enabled = cov.Enabled
			metadata.Advertised = cov.Advertised
			metadata.NativeBoundingBox = &models.BoundingBox{
				MinX: cov.NativeBoundingBox.MinX,
				MinY: cov.NativeBoundingBox.MinY,
				MaxX: cov.NativeBoundingBox.MaxX,
				MaxY: cov.NativeBoundingBox.MaxY,
				CRS:  cov.NativeBoundingBox.CRS,
			}
			metadata.LatLonBoundingBox = &models.BoundingBox{
				MinX: cov.LatLonBoundingBox.MinX,
				MinY: cov.LatLonBoundingBox.MinY,
				MaxX: cov.LatLonBoundingBox.MaxX,
				MaxY: cov.LatLonBoundingBox.MaxY,
				CRS:  cov.LatLonBoundingBox.CRS,
			}
		}
	}

	return metadata, nil
}

// UpdateLayerMetadata updates layer metadata
func (c *Client) UpdateLayerMetadata(workspace string, metadata *models.LayerMetadata) error {
	isFeatureType := metadata.StoreType == "datastore"

	// Build update body for the resource
	var resourcePath string
	var resourceBody map[string]interface{}

	if isFeatureType {
		resourcePath = fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes/%s", workspace, metadata.Store, metadata.Name)
		updateFields := map[string]interface{}{
			"enabled":    metadata.Enabled,
			"advertised": metadata.Advertised,
		}
		if metadata.Title != "" {
			updateFields["title"] = metadata.Title
		}
		if metadata.Abstract != "" {
			updateFields["abstract"] = metadata.Abstract
		}
		if len(metadata.Keywords) > 0 {
			updateFields["keywords"] = map[string]interface{}{
				"string": metadata.Keywords,
			}
		}
		if metadata.SRS != "" {
			updateFields["srs"] = metadata.SRS
		}
		resourceBody = map[string]interface{}{
			"featureType": updateFields,
		}
	} else {
		resourcePath = fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages/%s", workspace, metadata.Store, metadata.Name)
		updateFields := map[string]interface{}{
			"enabled":    metadata.Enabled,
			"advertised": metadata.Advertised,
		}
		if metadata.Title != "" {
			updateFields["title"] = metadata.Title
		}
		if metadata.Abstract != "" {
			updateFields["abstract"] = metadata.Abstract
		}
		if len(metadata.Keywords) > 0 {
			updateFields["keywords"] = map[string]interface{}{
				"string": metadata.Keywords,
			}
		}
		if metadata.SRS != "" {
			updateFields["srs"] = metadata.SRS
		}
		resourceBody = map[string]interface{}{
			"coverage": updateFields,
		}
	}

	resp, err := c.doJSONRequest("PUT", resourcePath, resourceBody)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update layer metadata: %s", string(bodyBytes))
	}

	// Update queryable on layer endpoint (only for vector)
	if isFeatureType {
		layerBody := map[string]interface{}{
			"layer": map[string]interface{}{
				"queryable": metadata.Queryable,
			},
		}

		layerResp, err := c.doJSONRequest("PUT", fmt.Sprintf("/layers/%s:%s", workspace, metadata.Name), layerBody)
		if err != nil {
			return nil // Non-critical
		}
		defer layerResp.Body.Close()
	}

	return nil
}

// extractStoreNameFromHref extracts the store name from a GeoServer resource href
// href format: .../workspaces/{ws}/datastores/{store}/featuretypes/{name}.json
// or: .../workspaces/{ws}/coveragestores/{store}/coverages/{name}.json
func (c *Client) extractStoreNameFromHref(href string, isFeatureType bool) string {
	var storeType string
	if isFeatureType {
		storeType = "datastores"
	} else {
		storeType = "coveragestores"
	}

	// Split by the store type path segment
	parts := strings.Split(href, "/"+storeType+"/")
	if len(parts) < 2 {
		return ""
	}

	// Get the part after datastores/ or coveragestores/
	storePart := parts[1]

	// The store name is before the next /
	storeNameParts := strings.Split(storePart, "/")
	if len(storeNameParts) < 1 {
		return ""
	}

	return storeNameParts[0]
}

// ============================================================================
// GeoWebCache (GWC) API Methods
// ============================================================================

// doGWCRequest performs an HTTP request to the GWC REST API
func (c *Client) doGWCRequest(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	url := c.baseURL + "/gwc/rest" + path

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

// doGWCJSONRequest performs a JSON request to GWC REST API
func (c *Client) doGWCJSONRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}
	return c.doGWCRequest(method, path, bodyReader, "application/json")
}

// GetGWCLayers fetches all cached layers from GeoWebCache
func (c *Client) GetGWCLayers() ([]models.GWCLayer, error) {
	resp, err := c.doGWCRequest("GET", "/layers", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get GWC layers: %s", string(body))
	}

	// GWC returns a list of layer names
	var result []string
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode GWC layers: %w", err)
	}

	// Convert to GWCLayer objects
	layers := make([]models.GWCLayer, len(result))
	for i, name := range result {
		layers[i] = models.GWCLayer{
			Name:    name,
			Enabled: true, // Assume enabled if listed
		}
	}

	return layers, nil
}

// GetGWCLayer fetches details for a specific cached layer
func (c *Client) GetGWCLayer(layerName string) (*models.GWCLayer, error) {
	resp, err := c.doGWCRequest("GET", fmt.Sprintf("/layers/%s.json", layerName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get GWC layer: %s", string(body))
	}

	var result struct {
		GeoServerLayer struct {
			Name       string `json:"name"`
			Enabled    bool   `json:"enabled"`
			GridSubsets []struct {
				GridSetName string `json:"gridSetName"`
			} `json:"gridSubsets"`
			MimeFormats []string `json:"mimeFormats"`
		} `json:"GeoServerLayer"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode GWC layer: %w", err)
	}

	layer := &models.GWCLayer{
		Name:        result.GeoServerLayer.Name,
		Enabled:     result.GeoServerLayer.Enabled,
		MimeFormats: result.GeoServerLayer.MimeFormats,
	}

	// Extract grid set names
	for _, gs := range result.GeoServerLayer.GridSubsets {
		layer.GridSubsets = append(layer.GridSubsets, gs.GridSetName)
	}

	return layer, nil
}

// SeedLayer starts a seed/reseed operation for a layer
func (c *Client) SeedLayer(layerName string, request models.GWCSeedRequest) error {
	// Build the seed request body in GWC format
	body := map[string]interface{}{
		"seedRequest": map[string]interface{}{
			"name":        layerName,
			"gridSetId":   request.GridSetID,
			"zoomStart":   request.ZoomStart,
			"zoomStop":    request.ZoomStop,
			"format":      request.Format,
			"type":        request.Type, // seed, reseed, or truncate
			"threadCount": request.ThreadCount,
		},
	}

	if request.Bounds != nil {
		body["seedRequest"].(map[string]interface{})["bounds"] = map[string]interface{}{
			"coords": map[string]interface{}{
				"double": []float64{
					request.Bounds.MinX,
					request.Bounds.MinY,
					request.Bounds.MaxX,
					request.Bounds.MaxY,
				},
			},
			"srs": map[string]interface{}{
				"number": request.Bounds.SRS,
			},
		}
	}

	resp, err := c.doGWCJSONRequest("POST", fmt.Sprintf("/seed/%s.json", layerName), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to start seed operation: %s", string(bodyBytes))
	}

	return nil
}

// TruncateLayer truncates (clears) all cached tiles for a layer
func (c *Client) TruncateLayer(layerName string, gridSetID, format string, zoomStart, zoomStop int) error {
	request := models.GWCSeedRequest{
		GridSetID:   gridSetID,
		ZoomStart:   zoomStart,
		ZoomStop:    zoomStop,
		Format:      format,
		Type:        "truncate",
		ThreadCount: 1,
	}
	return c.SeedLayer(layerName, request)
}

// GetSeedStatus gets the status of running seed tasks for a layer
func (c *Client) GetSeedStatus(layerName string) (*models.GWCSeedStatus, error) {
	resp, err := c.doGWCRequest("GET", fmt.Sprintf("/seed/%s.json", layerName), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get seed status: %s", string(body))
	}

	// GWC returns an array of arrays with task info
	// Format: [[tiles done, tiles total, time remaining, task id, status]]
	var result struct {
		LongArrayArray [][]int64 `json:"long-array-array"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode seed status: %w", err)
	}

	status := &models.GWCSeedStatus{
		Tasks: make([]models.GWCSeedTask, 0),
	}

	for _, taskData := range result.LongArrayArray {
		if len(taskData) >= 5 {
			task := models.GWCSeedTask{
				TilesDone:     taskData[0],
				TilesTotal:    taskData[1],
				TimeRemaining: taskData[2],
				ID:            taskData[3],
				LayerName:     layerName,
			}
			// Status is encoded as an integer
			switch taskData[4] {
			case 0:
				task.Status = "Pending"
			case 1:
				task.Status = "Running"
			case 2:
				task.Status = "Done"
			case -1:
				task.Status = "Aborted"
			default:
				task.Status = "Unknown"
			}
			status.Tasks = append(status.Tasks, task)
		}
	}

	return status, nil
}

// TerminateSeedTasks terminates running seed tasks
// killType can be: "running" (kill running tasks), "pending" (kill pending), or "all" (kill both)
func (c *Client) TerminateSeedTasks(killType string) error {
	resp, err := c.doGWCRequest("POST", fmt.Sprintf("/seed?kill_all=%s", killType), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to terminate seed tasks: %s", string(body))
	}

	return nil
}

// TerminateLayerSeedTasks terminates seed tasks for a specific layer
func (c *Client) TerminateLayerSeedTasks(layerName string) error {
	// GWC REST API expects kill_all as a query parameter, not JSON body
	resp, err := c.doGWCRequest("POST", fmt.Sprintf("/seed/%s?kill_all=all", layerName), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to terminate layer seed tasks: %s", string(bodyBytes))
	}

	return nil
}

// GetGWCGridSets fetches all available grid sets
func (c *Client) GetGWCGridSets() ([]models.GWCGridSet, error) {
	resp, err := c.doGWCRequest("GET", "/gridsets", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get grid sets: %s", string(body))
	}

	// GWC returns a list of grid set names
	var names []string
	if err := json.NewDecoder(resp.Body).Decode(&names); err != nil {
		return nil, fmt.Errorf("failed to decode grid sets: %w", err)
	}

	gridSets := make([]models.GWCGridSet, len(names))
	for i, name := range names {
		gridSets[i] = models.GWCGridSet{Name: name}
	}

	return gridSets, nil
}

// GetGWCGridSet fetches details for a specific grid set
func (c *Client) GetGWCGridSet(name string) (*models.GWCGridSet, error) {
	resp, err := c.doGWCRequest("GET", fmt.Sprintf("/gridsets/%s.json", name), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get grid set: %s", string(body))
	}

	var result struct {
		GridSet struct {
			Name        string  `json:"name"`
			SRS         struct {
				Number int `json:"number"`
			} `json:"srs"`
			TileWidth   int     `json:"tileWidth"`
			TileHeight  int     `json:"tileHeight"`
			Extent      struct {
				Coords struct {
					Double []float64 `json:"double"`
				} `json:"coords"`
			} `json:"extent"`
		} `json:"gridSet"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode grid set: %w", err)
	}

	gridSet := &models.GWCGridSet{
		Name:       result.GridSet.Name,
		SRS:        fmt.Sprintf("EPSG:%d", result.GridSet.SRS.Number),
		TileWidth:  result.GridSet.TileWidth,
		TileHeight: result.GridSet.TileHeight,
	}

	if len(result.GridSet.Extent.Coords.Double) >= 4 {
		gridSet.MinX = result.GridSet.Extent.Coords.Double[0]
		gridSet.MinY = result.GridSet.Extent.Coords.Double[1]
		gridSet.MaxX = result.GridSet.Extent.Coords.Double[2]
		gridSet.MaxY = result.GridSet.Extent.Coords.Double[3]
	}

	return gridSet, nil
}

// GetGWCDiskQuota fetches the disk quota configuration
func (c *Client) GetGWCDiskQuota() (*models.GWCDiskQuota, error) {
	resp, err := c.doGWCRequest("GET", "/diskquota.json", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get disk quota: %s", string(body))
	}

	var result struct {
		DiskQuota struct {
			Enabled          bool   `json:"enabled"`
			DiskBlockSize    int    `json:"diskBlockSize"`
			CacheCleanUpFreq int    `json:"cacheCleanUpFrequency"`
			MaxConcurrent    int    `json:"maxConcurrentCleanUps"`
			GlobalQuota      struct {
				Value string `json:"value"`
				Units string `json:"units"`
			} `json:"globalQuota"`
		} `json:"gwcQuotaConfiguration"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode disk quota: %w", err)
	}

	quota := &models.GWCDiskQuota{
		Enabled:          result.DiskQuota.Enabled,
		DiskBlockSize:    result.DiskQuota.DiskBlockSize,
		CacheCleanUpFreq: result.DiskQuota.CacheCleanUpFreq,
		MaxConcurrent:    result.DiskQuota.MaxConcurrent,
	}

	if result.DiskQuota.GlobalQuota.Value != "" {
		quota.GlobalQuota = fmt.Sprintf("%s %s", result.DiskQuota.GlobalQuota.Value, result.DiskQuota.GlobalQuota.Units)
	}

	return quota, nil
}

// UpdateGWCDiskQuota updates the disk quota configuration
func (c *Client) UpdateGWCDiskQuota(quota models.GWCDiskQuota) error {
	body := map[string]interface{}{
		"gwcQuotaConfiguration": map[string]interface{}{
			"enabled":               quota.Enabled,
			"diskBlockSize":         quota.DiskBlockSize,
			"cacheCleanUpFrequency": quota.CacheCleanUpFreq,
			"maxConcurrentCleanUps": quota.MaxConcurrent,
		},
	}

	resp, err := c.doGWCJSONRequest("PUT", "/diskquota.json", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update disk quota: %s", string(bodyBytes))
	}

	return nil
}

// MassGWCTruncate truncates all tiles for multiple layers
func (c *Client) MassGWCTruncate(layerNames []string) error {
	for _, name := range layerNames {
		// Get layer info to find grid sets and formats
		layer, err := c.GetGWCLayer(name)
		if err != nil {
			return fmt.Errorf("failed to get layer %s info: %w", name, err)
		}

		// Truncate each grid set and format combination
		for _, gridSet := range layer.GridSubsets {
			for _, format := range layer.MimeFormats {
				if err := c.TruncateLayer(name, gridSet, format, 0, 20); err != nil {
					return fmt.Errorf("failed to truncate %s: %w", name, err)
				}
			}
		}
	}
	return nil
}

// GetGlobalSettings fetches the GeoServer global settings
func (c *Client) GetGlobalSettings() (*models.GeoServerGlobalSettings, error) {
	resp, err := c.doRequest("GET", "/settings", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get global settings: %s", string(body))
	}

	var result struct {
		Global struct {
			Settings struct {
				Charset           string `json:"charset"`
				NumDecimals       int    `json:"numDecimals"`
				OnlineResource    string `json:"onlineResource"`
				Verbose           bool   `json:"verbose"`
				VerboseExceptions bool   `json:"verboseExceptions"`
				ProxyBaseURL      string `json:"proxyBaseUrl"`
				Contact           struct {
					ContactPerson       string `json:"contactPerson"`
					ContactOrganization string `json:"contactOrganization"`
					ContactPosition     string `json:"contactPosition"`
					AddressType         string `json:"addressType"`
					Address             string `json:"address"`
					AddressCity         string `json:"addressCity"`
					AddressState        string `json:"addressState"`
					AddressPostCode     string `json:"addressPostalCode"`
					AddressCountry      string `json:"addressCountry"`
					ContactVoice        string `json:"contactVoice"`
					ContactFax          string `json:"contactFacsimile"`
					ContactEmail        string `json:"contactEmail"`
				} `json:"contact"`
			} `json:"settings"`
		} `json:"global"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode global settings: %w", err)
	}

	settings := &models.GeoServerGlobalSettings{
		Charset:           result.Global.Settings.Charset,
		NumDecimals:       result.Global.Settings.NumDecimals,
		OnlineResource:    result.Global.Settings.OnlineResource,
		Verbose:           result.Global.Settings.Verbose,
		VerboseExceptions: result.Global.Settings.VerboseExceptions,
		ProxyBaseURL:      result.Global.Settings.ProxyBaseURL,
		Contact: &models.GeoServerContact{
			ContactPerson:       result.Global.Settings.Contact.ContactPerson,
			ContactOrganization: result.Global.Settings.Contact.ContactOrganization,
			ContactPosition:     result.Global.Settings.Contact.ContactPosition,
			AddressType:         result.Global.Settings.Contact.AddressType,
			Address:             result.Global.Settings.Contact.Address,
			AddressCity:         result.Global.Settings.Contact.AddressCity,
			AddressState:        result.Global.Settings.Contact.AddressState,
			AddressPostCode:     result.Global.Settings.Contact.AddressPostCode,
			AddressCountry:      result.Global.Settings.Contact.AddressCountry,
			ContactVoice:        result.Global.Settings.Contact.ContactVoice,
			ContactFax:          result.Global.Settings.Contact.ContactFax,
			ContactEmail:        result.Global.Settings.Contact.ContactEmail,
		},
	}

	return settings, nil
}

// GetContact fetches the GeoServer contact information
func (c *Client) GetContact() (*models.GeoServerContact, error) {
	resp, err := c.doRequest("GET", "/settings/contact", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get contact: %s", string(body))
	}

	var result struct {
		Contact struct {
			ContactPerson       string `json:"contactPerson"`
			ContactOrganization string `json:"contactOrganization"`
			ContactPosition     string `json:"contactPosition"`
			AddressType         string `json:"addressType"`
			Address             string `json:"address"`
			AddressCity         string `json:"addressCity"`
			AddressState        string `json:"addressState"`
			AddressPostCode     string `json:"addressPostalCode"`
			AddressCountry      string `json:"addressCountry"`
			ContactVoice        string `json:"contactVoice"`
			ContactFax          string `json:"contactFacsimile"`
			ContactEmail        string `json:"contactEmail"`
			OnlineResource      string `json:"onlineResource"`
			Welcome             string `json:"welcome"`
		} `json:"contact"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode contact: %w", err)
	}

	contact := &models.GeoServerContact{
		ContactPerson:       result.Contact.ContactPerson,
		ContactOrganization: result.Contact.ContactOrganization,
		ContactPosition:     result.Contact.ContactPosition,
		AddressType:         result.Contact.AddressType,
		Address:             result.Contact.Address,
		AddressCity:         result.Contact.AddressCity,
		AddressState:        result.Contact.AddressState,
		AddressPostCode:     result.Contact.AddressPostCode,
		AddressCountry:      result.Contact.AddressCountry,
		ContactVoice:        result.Contact.ContactVoice,
		ContactFax:          result.Contact.ContactFax,
		ContactEmail:        result.Contact.ContactEmail,
		OnlineResource:      result.Contact.OnlineResource,
		Welcome:             result.Contact.Welcome,
	}

	return contact, nil
}

// UpdateContact updates the GeoServer contact information
func (c *Client) UpdateContact(contact *models.GeoServerContact) error {
	body := map[string]interface{}{
		"contact": map[string]interface{}{
			"contactPerson":       contact.ContactPerson,
			"contactOrganization": contact.ContactOrganization,
			"contactPosition":     contact.ContactPosition,
			"addressType":         contact.AddressType,
			"address":             contact.Address,
			"addressCity":         contact.AddressCity,
			"addressState":        contact.AddressState,
			"addressPostalCode":   contact.AddressPostCode,
			"addressCountry":      contact.AddressCountry,
			"contactVoice":        contact.ContactVoice,
			"contactFacsimile":    contact.ContactFax,
			"contactEmail":        contact.ContactEmail,
			"onlineResource":      contact.OnlineResource,
			"welcome":             contact.Welcome,
		},
	}

	resp, err := c.doJSONRequest("PUT", "/settings/contact", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update contact: %s", string(bodyBytes))
	}

	return nil
}

// ============================================================================
// Download Functions - Export resource configurations as JSON/SLD
// ============================================================================

// DownloadWorkspace returns the workspace configuration as JSON bytes
func (c *Client) DownloadWorkspace(name string) ([]byte, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/workspaces/%s", name), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("workspace not found: %s", name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadDataStore returns the data store configuration as JSON bytes
func (c *Client) DownloadDataStore(workspace, name string) ([]byte, error) {
	path := fmt.Sprintf("/workspaces/%s/datastores/%s", workspace, name)
	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("data store not found: %s/%s", workspace, name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadCoverageStore returns the coverage store configuration as JSON bytes
func (c *Client) DownloadCoverageStore(workspace, name string) ([]byte, error) {
	path := fmt.Sprintf("/workspaces/%s/coveragestores/%s", workspace, name)
	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("coverage store not found: %s/%s", workspace, name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadLayer returns the layer configuration as JSON bytes
func (c *Client) DownloadLayer(workspace, name string) ([]byte, error) {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/layers/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/layers/%s", workspace, name)
	}

	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("layer not found: %s", name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadStyle returns the style content (SLD/CSS) as bytes
func (c *Client) DownloadStyle(workspace, name string) ([]byte, string, error) {
	// First get style info to determine format
	var infoPath string
	if workspace == "" {
		infoPath = fmt.Sprintf("/styles/%s", name)
	} else {
		infoPath = fmt.Sprintf("/workspaces/%s/styles/%s", workspace, name)
	}

	resp, err := c.doRequest("GET", infoPath, nil, "")
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("style not found: %s", name)
	}

	var styleInfo struct {
		Style struct {
			Format   string `json:"format"`
			Filename string `json:"filename"`
		} `json:"style"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&styleInfo); err != nil {
		return nil, "", err
	}

	// Now get the actual style content
	format := styleInfo.Style.Format
	if format == "" {
		format = "sld"
	}

	// Determine content type and extension
	var contentType, ext string
	switch format {
	case "css":
		contentType = "application/vnd.geoserver.geocss+css"
		ext = ".css"
	case "mbstyle":
		contentType = "application/vnd.geoserver.mbstyle+json"
		ext = ".json"
	default: // sld
		contentType = "application/vnd.ogc.sld+xml"
		ext = ".sld"
	}

	// Create request for style content
	url := c.baseURL + "/rest" + infoPath + ".sld"
	if format == "css" {
		url = c.baseURL + "/rest" + infoPath + ".css"
	} else if format == "mbstyle" {
		url = c.baseURL + "/rest" + infoPath + ".mbstyle"
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, "", err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Accept", contentType)

	resp2, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("failed to download style content")
	}

	data, err := io.ReadAll(resp2.Body)
	return data, ext, err
}

// DownloadLayerGroup returns the layer group configuration as JSON bytes
func (c *Client) DownloadLayerGroup(workspace, name string) ([]byte, error) {
	var path string
	if workspace == "" {
		path = fmt.Sprintf("/layergroups/%s", name)
	} else {
		path = fmt.Sprintf("/workspaces/%s/layergroups/%s", workspace, name)
	}

	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("layer group not found: %s", name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadFeatureType returns the feature type configuration as JSON bytes
func (c *Client) DownloadFeatureType(workspace, store, name string) ([]byte, error) {
	path := fmt.Sprintf("/workspaces/%s/datastores/%s/featuretypes/%s", workspace, store, name)
	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("feature type not found: %s/%s/%s", workspace, store, name)
	}

	return io.ReadAll(resp.Body)
}

// DownloadCoverage returns the coverage configuration as JSON bytes
func (c *Client) DownloadCoverage(workspace, store, name string) ([]byte, error) {
	path := fmt.Sprintf("/workspaces/%s/coveragestores/%s/coverages/%s", workspace, store, name)
	resp, err := c.doRequest("GET", path, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("coverage not found: %s/%s/%s", workspace, store, name)
	}

	return io.ReadAll(resp.Body)
}
