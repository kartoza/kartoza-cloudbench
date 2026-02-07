package components

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/harmonica"
	"github.com/charmbracelet/lipgloss"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
	"github.com/kartoza/kartoza-geoserver-client/internal/tui/styles"
)

// InfoDialogAnimationMsg is sent to update animation state
type InfoDialogAnimationMsg struct {
	ID string
}

// InfoDialogMetadataMsg is sent when extended metadata is loaded
type InfoDialogMetadataMsg struct {
	ID       string
	Metadata *ExtendedNodeMetadata
	Error    error
}

// ExtendedNodeMetadata contains detailed metadata from GeoServer REST API
type ExtendedNodeMetadata struct {
	// Server info (for connection nodes)
	ServerVersion      string
	ServerBuild        string
	ServerRevision     string
	GeoToolsVersion    string
	GeoWebCacheVersion string

	// Store info
	StoreDescription string
	StoreEnabled     bool
	StoreURL         string // File path on server
	StoreFormat      string

	// Layer info
	LayerTitle        string
	LayerAbstract     string
	LayerNativeCRS    string
	LayerSRS          string
	LayerDefaultStyle string
	LayerEnabled      bool
	LayerQueryable    bool
	LayerAdvertised   bool
	LayerKeywords     []string

	// Bounding boxes
	NativeBBox BoundingBox
	LatLonBBox BoundingBox

	// Coverage specific
	CoverageNativeFormat  string
	CoverageDimensions    []string
	CoverageInterpolation string

	// Timestamps
	DateCreated  string
	DateModified string
}

// BoundingBox represents a bounding box
type BoundingBox struct {
	MinX float64
	MinY float64
	MaxX float64
	MaxY float64
	CRS  string
}

// InfoDialog displays detailed information about a resource
type InfoDialog struct {
	id          string
	title       string
	icon        string
	details     []InfoItem
	width       int
	height      int
	visible     bool

	// Extended metadata from GeoServer REST API
	extendedMetadata *ExtendedNodeMetadata
	metadataLoading  bool
	metadataError    error

	// Connection info for metadata fetching
	geoserverURL string
	username     string
	password     string
	node         *models.TreeNode

	// Scroll position for long dialogs
	scrollOffset int
	maxScroll    int

	// Harmonica physics for smooth animations
	spring        harmonica.Spring
	animScale     float64
	animVelocity  float64
	animOpacity   float64
	targetScale   float64
	targetOpacity float64
	animating     bool
	closing       bool
}

// InfoItem represents a single piece of information to display
type InfoItem struct {
	Label string
	Value string
	Style lipgloss.Style
}

// NewInfoDialog creates a new info dialog
func NewInfoDialog(title, icon string, details []InfoItem) *InfoDialog {
	return &InfoDialog{
		id:            title,
		title:         title,
		icon:          icon,
		details:       details,
		visible:       true,
		spring:        harmonica.NewSpring(harmonica.FPS(60), 6.0, 0.5),
		animScale:     0.0,
		animOpacity:   0.0,
		targetScale:   1.0,
		targetOpacity: 1.0,
		animating:     true,
	}
}

// NewFileInfoDialog creates an info dialog for a local file
func NewFileInfoDialog(file *models.LocalFile) *InfoDialog {
	details := []InfoItem{
		{Label: "Name", Value: file.Name},
		{Label: "Path", Value: file.Path},
		{Label: "Type", Value: file.Type.String()},
		{Label: "Size", Value: formatFileSize(file.Size)},
	}

	if file.IsDir {
		details[2].Value = "Directory"
	}

	if file.Type.CanUpload() {
		details = append(details, InfoItem{
			Label: "Uploadable",
			Value: "Yes",
			Style: styles.SuccessStyle,
		})
	}

	return NewInfoDialog("File Information", file.Type.Icon(), details)
}

// NewTreeNodeInfoDialog creates an info dialog for a tree node
func NewTreeNodeInfoDialog(node *models.TreeNode) *InfoDialog {
	return NewTreeNodeInfoDialogWithConnection(node, "", "", "")
}

// NewTreeNodeInfoDialogWithConnection creates an info dialog with connection info for extended metadata
func NewTreeNodeInfoDialogWithConnection(node *models.TreeNode, geoserverURL, username, password string) *InfoDialog {
	details := []InfoItem{
		{Label: "Name", Value: node.Name},
		{Label: "Type", Value: node.Type.String()},
	}

	// For connection nodes, show the URL instead of the tree path
	if node.Type == models.NodeTypeConnection {
		if geoserverURL != "" {
			details = append(details, InfoItem{Label: "URL", Value: geoserverURL})
		}
		if username != "" {
			details = append(details, InfoItem{Label: "Username", Value: username})
		}
	} else {
		details = append(details, InfoItem{Label: "Path", Value: node.Path()})
	}

	if node.Workspace != "" {
		details = append(details, InfoItem{Label: "Workspace", Value: node.Workspace})
	}

	if node.StoreName != "" {
		details = append(details, InfoItem{Label: "Store", Value: node.StoreName})
	}

	if node.HasError {
		details = append(details, InfoItem{
			Label: "Error",
			Value: node.ErrorMsg,
			Style: styles.ErrorStyle,
		})
	}

	status := "Ready"
	statusStyle := styles.SuccessStyle
	if node.IsLoading {
		status = "Loading..."
		statusStyle = styles.LoadingStyle
	} else if !node.IsLoaded && len(node.Children) == 0 {
		status = "Not loaded"
		statusStyle = styles.MutedStyle
	}
	details = append(details, InfoItem{
		Label: "Status",
		Value: status,
		Style: statusStyle,
	})

	if len(node.Children) > 0 {
		details = append(details, InfoItem{
			Label: "Children",
			Value: fmt.Sprintf("%d items", len(node.Children)),
		})
	}

	// Use different title for connection nodes
	title := "Resource Information"
	if node.Type == models.NodeTypeConnection {
		title = "Server Information"
	}

	dialog := NewInfoDialog(title, node.Type.Icon(), details)
	dialog.geoserverURL = geoserverURL
	dialog.username = username
	dialog.password = password
	dialog.node = node

	// Enable metadata loading for layers, stores, AND connections
	if geoserverURL != "" &&
		(node.Type == models.NodeTypeConnection ||
			(node.Workspace != "" &&
				(node.Type == models.NodeTypeLayer ||
					node.Type == models.NodeTypeDataStore ||
					node.Type == models.NodeTypeCoverageStore))) {
		dialog.metadataLoading = true
	}

	return dialog
}

// formatFileSize formats a file size in bytes to a human-readable string
func formatFileSize(size int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)

	switch {
	case size >= GB:
		return fmt.Sprintf("%.2f GB", float64(size)/GB)
	case size >= MB:
		return fmt.Sprintf("%.2f MB", float64(size)/MB)
	case size >= KB:
		return fmt.Sprintf("%.2f KB", float64(size)/KB)
	default:
		return fmt.Sprintf("%d bytes", size)
	}
}

// SetSize sets the dialog size
func (d *InfoDialog) SetSize(width, height int) {
	d.width = width
	d.height = height
}

// IsVisible returns whether the dialog is visible
func (d *InfoDialog) IsVisible() bool {
	return d.visible
}

// StartCloseAnimation starts the closing animation
func (d *InfoDialog) StartCloseAnimation() tea.Cmd {
	d.closing = true
	d.targetScale = 0.0
	d.targetOpacity = 0.0
	d.animating = true
	// Use a stiffer, critically-damped spring for faster closing
	d.spring = harmonica.NewSpring(harmonica.FPS(60), 12.0, 1.0)
	return d.animateCmd()
}

// animateCmd returns a command to continue the animation
func (d *InfoDialog) animateCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg {
		return InfoDialogAnimationMsg{ID: d.id}
	})
}

// Init initializes the dialog and starts the opening animation
func (d *InfoDialog) Init() tea.Cmd {
	cmds := []tea.Cmd{d.animateCmd()}

	// Start fetching extended metadata if configured
	if d.metadataLoading && d.node != nil {
		cmds = append(cmds, d.fetchMetadataCmd())
	}

	return tea.Batch(cmds...)
}

// fetchMetadataCmd returns a command that fetches extended metadata
func (d *InfoDialog) fetchMetadataCmd() tea.Cmd {
	// Capture values to avoid race conditions
	id := d.id
	geoserverURL := d.geoserverURL
	username := d.username
	password := d.password
	node := d.node

	return func() tea.Msg {
		if node == nil || geoserverURL == "" {
			return InfoDialogMetadataMsg{
				ID:    id,
				Error: fmt.Errorf("missing configuration"),
			}
		}

		metadata := &ExtendedNodeMetadata{}
		client := &http.Client{Timeout: 10 * time.Second}

		// For connection nodes, fetch server info
		if node.Type == models.NodeTypeConnection {
			fetchServerInfo(client, geoserverURL, username, password, metadata)
		} else {
			// Fetch store metadata
			fetchStoreMetadataForNode(client, geoserverURL, username, password, node, metadata)

			// Fetch layer metadata
			fetchLayerMetadataForNode(client, geoserverURL, username, password, node, metadata)
		}

		return InfoDialogMetadataMsg{
			ID:       id,
			Metadata: metadata,
		}
	}
}

// fetchServerInfo fetches GeoServer version and status information
func fetchServerInfo(client *http.Client, geoserverURL, username, password string, metadata *ExtendedNodeMetadata) {
	serverURL := fmt.Sprintf("%s/rest/about/version.json", geoserverURL)

	req, err := http.NewRequest("GET", serverURL, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	body, _ := io.ReadAll(resp.Body)

	var result struct {
		About struct {
			Resource []struct {
				Name           string      `json:"@name"`
				Version        interface{} `json:"Version"`
				BuildTimestamp string      `json:"Build-Timestamp"`
				GitRevision    string      `json:"Git-Revision"`
			} `json:"resource"`
		} `json:"about"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return
	}

	for _, r := range result.About.Resource {
		switch r.Name {
		case "GeoServer":
			metadata.ServerVersion = fmt.Sprintf("%v", r.Version)
			metadata.ServerBuild = r.BuildTimestamp
			metadata.ServerRevision = r.GitRevision
		case "GeoTools":
			metadata.GeoToolsVersion = fmt.Sprintf("%v", r.Version)
		case "GeoWebCache":
			metadata.GeoWebCacheVersion = fmt.Sprintf("%v", r.Version)
		}
	}
}

// fetchStoreMetadataForNode fetches store information from GeoServer REST API (standalone function for goroutine safety)
func fetchStoreMetadataForNode(client *http.Client, geoserverURL, username, password string, node *models.TreeNode, metadata *ExtendedNodeMetadata) {
	// For store nodes, we use the node name as the store name
	// For layer nodes, we use the StoreName field
	isStoreNode := node.Type == models.NodeTypeDataStore || node.Type == models.NodeTypeCoverageStore

	if node.StoreName == "" && !isStoreNode {
		return
	}

	storeName := node.StoreName
	if storeName == "" || isStoreNode {
		storeName = node.Name
	}

	var storeURL string
	isRaster := node.StoreType == "coveragestore" || node.Type == models.NodeTypeCoverageStore
	if isRaster {
		storeURL = fmt.Sprintf("%s/rest/workspaces/%s/coveragestores/%s.json",
			geoserverURL, node.Workspace, storeName)
	} else {
		storeURL = fmt.Sprintf("%s/rest/workspaces/%s/datastores/%s.json",
			geoserverURL, node.Workspace, storeName)
	}

	req, err := http.NewRequest("GET", storeURL, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	body, _ := io.ReadAll(resp.Body)

	if isRaster {
		var result struct {
			CoverageStore struct {
				Description  string `json:"description"`
				Enabled      bool   `json:"enabled"`
				Type         string `json:"type"`
				URL          string `json:"url"`
				DateCreated  string `json:"dateCreated"`
				DateModified string `json:"dateModified"`
			} `json:"coverageStore"`
		}
		if err := json.Unmarshal(body, &result); err == nil {
			metadata.StoreDescription = result.CoverageStore.Description
			metadata.StoreEnabled = result.CoverageStore.Enabled
			metadata.StoreURL = result.CoverageStore.URL
			metadata.StoreFormat = result.CoverageStore.Type
			metadata.DateCreated = result.CoverageStore.DateCreated
			metadata.DateModified = result.CoverageStore.DateModified
		}
	} else {
		var result struct {
			DataStore struct {
				Description  string `json:"description"`
				Enabled      bool   `json:"enabled"`
				Type         string `json:"type"`
				DateCreated  string `json:"dateCreated"`
				DateModified string `json:"dateModified"`
				ConnectionParameters struct {
					Entry []struct {
						Key   string `json:"@key"`
						Value string `json:"$"`
					} `json:"entry"`
				} `json:"connectionParameters"`
			} `json:"dataStore"`
		}
		if err := json.Unmarshal(body, &result); err == nil {
			metadata.StoreDescription = result.DataStore.Description
			metadata.StoreEnabled = result.DataStore.Enabled
			metadata.StoreFormat = result.DataStore.Type
			metadata.DateCreated = result.DataStore.DateCreated
			metadata.DateModified = result.DataStore.DateModified

			for _, entry := range result.DataStore.ConnectionParameters.Entry {
				if entry.Key == "url" || entry.Key == "database" || entry.Key == "dbname" {
					metadata.StoreURL = entry.Value
					break
				}
			}
		}
	}
}

// fetchLayerMetadataForNode fetches layer information from GeoServer REST API (standalone function for goroutine safety)
func fetchLayerMetadataForNode(client *http.Client, geoserverURL, username, password string, node *models.TreeNode, metadata *ExtendedNodeMetadata) {
	if node.Type != models.NodeTypeLayer {
		return
	}

	// First fetch layer info
	layerURL := fmt.Sprintf("%s/rest/layers/%s:%s.json",
		geoserverURL, node.Workspace, node.Name)

	req, err := http.NewRequest("GET", layerURL, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)

		// Use pointers to detect if booleans are present in JSON
		var layerResult struct {
			Layer struct {
				Enabled      *bool `json:"enabled"`
				Queryable    *bool `json:"queryable"`
				Advertised   *bool `json:"advertised"`
				DefaultStyle struct {
					Name string `json:"name"`
				} `json:"defaultStyle"`
				Resource struct {
					Href string `json:"href"`
				} `json:"resource"`
			} `json:"layer"`
		}

		if err := json.Unmarshal(body, &layerResult); err == nil {
			// Handle optional booleans - GeoServer may omit some if at default values
			// Default advertised to true as GeoServer omits it when true
			metadata.LayerAdvertised = true
			if layerResult.Layer.Enabled != nil {
				metadata.LayerEnabled = *layerResult.Layer.Enabled
			}
			if layerResult.Layer.Queryable != nil {
				metadata.LayerQueryable = *layerResult.Layer.Queryable
			}
			if layerResult.Layer.Advertised != nil {
				metadata.LayerAdvertised = *layerResult.Layer.Advertised
			}
			metadata.LayerDefaultStyle = layerResult.Layer.DefaultStyle.Name

			// Fetch resource details
			if layerResult.Layer.Resource.Href != "" {
				fetchResourceMetadata(client, username, password, layerResult.Layer.Resource.Href, metadata)
			}
		}
	}

	// Try direct featuretype/coverage fetch if needed
	if metadata.LayerTitle == "" && node.StoreName != "" {
		isRaster := node.StoreType == "coveragestore"
		if isRaster {
			fetchCoverageMetadata(client, geoserverURL, username, password, node, metadata)
		} else {
			fetchFeatureTypeMetadata(client, geoserverURL, username, password, node, metadata)
		}
	}
}

// fetchResourceMetadata fetches the resource details from the href (standalone function)
func fetchResourceMetadata(client *http.Client, username, password, href string, metadata *ExtendedNodeMetadata) {
	req, err := http.NewRequest("GET", href, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	body, _ := io.ReadAll(resp.Body)
	parseResourceResponse(body, metadata)
}

// fetchFeatureTypeMetadata fetches feature type information (standalone function)
func fetchFeatureTypeMetadata(client *http.Client, geoserverURL, username, password string, node *models.TreeNode, metadata *ExtendedNodeMetadata) {
	ftURL := fmt.Sprintf("%s/rest/workspaces/%s/datastores/%s/featuretypes/%s.json",
		geoserverURL, node.Workspace, node.StoreName, node.Name)

	req, err := http.NewRequest("GET", ftURL, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		parseResourceResponse(body, metadata)
	}
}

// fetchCoverageMetadata fetches coverage information (standalone function)
func fetchCoverageMetadata(client *http.Client, geoserverURL, username, password string, node *models.TreeNode, metadata *ExtendedNodeMetadata) {
	covURL := fmt.Sprintf("%s/rest/workspaces/%s/coveragestores/%s/coverages/%s.json",
		geoserverURL, node.Workspace, node.StoreName, node.Name)

	req, err := http.NewRequest("GET", covURL, nil)
	if err != nil {
		return
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		parseResourceResponse(body, metadata)
	}
}

// parseResourceResponse parses featuretype or coverage response (standalone function)
func parseResourceResponse(body []byte, metadata *ExtendedNodeMetadata) {
	// Try featuretype first
	var ftResult struct {
		FeatureType struct {
			Name      string      `json:"name"`
			Title     string      `json:"title"`
			Abstract  string      `json:"abstract"`
			NativeCRS interface{} `json:"nativeCRS"`
			SRS       string      `json:"srs"`
			Keywords  struct {
				String []string `json:"string"`
			} `json:"keywords"`
			NativeBoundingBox struct {
				MinX float64     `json:"minx"`
				MinY float64     `json:"miny"`
				MaxX float64     `json:"maxx"`
				MaxY float64     `json:"maxy"`
				CRS  interface{} `json:"crs"`
			} `json:"nativeBoundingBox"`
			LatLonBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
			} `json:"latLonBoundingBox"`
		} `json:"featureType"`
	}

	if err := json.Unmarshal(body, &ftResult); err == nil && ftResult.FeatureType.Name != "" {
		ft := ftResult.FeatureType
		metadata.LayerTitle = ft.Title
		metadata.LayerAbstract = ft.Abstract
		metadata.LayerSRS = ft.SRS
		metadata.LayerKeywords = ft.Keywords.String

		switch v := ft.NativeCRS.(type) {
		case string:
			metadata.LayerNativeCRS = v
		case map[string]interface{}:
			if wkt, ok := v["$"].(string); ok {
				metadata.LayerNativeCRS = wkt
			}
		}

		metadata.NativeBBox.MinX = ft.NativeBoundingBox.MinX
		metadata.NativeBBox.MinY = ft.NativeBoundingBox.MinY
		metadata.NativeBBox.MaxX = ft.NativeBoundingBox.MaxX
		metadata.NativeBBox.MaxY = ft.NativeBoundingBox.MaxY

		switch v := ft.NativeBoundingBox.CRS.(type) {
		case string:
			metadata.NativeBBox.CRS = v
		case map[string]interface{}:
			if code, ok := v["$"].(string); ok {
				metadata.NativeBBox.CRS = code
			}
		}

		metadata.LatLonBBox.MinX = ft.LatLonBoundingBox.MinX
		metadata.LatLonBBox.MinY = ft.LatLonBoundingBox.MinY
		metadata.LatLonBBox.MaxX = ft.LatLonBoundingBox.MaxX
		metadata.LatLonBBox.MaxY = ft.LatLonBoundingBox.MaxY
		return
	}

	// Try coverage
	var covResult struct {
		Coverage struct {
			Name         string      `json:"name"`
			Title        string      `json:"title"`
			Abstract     string      `json:"abstract"`
			NativeCRS    interface{} `json:"nativeCRS"`
			SRS          string      `json:"srs"`
			NativeFormat string      `json:"nativeFormat"`
			Keywords     struct {
				String []string `json:"string"`
			} `json:"keywords"`
			Dimensions struct {
				CoverageDimension []struct {
					Name string `json:"name"`
				} `json:"coverageDimension"`
			} `json:"dimensions"`
			Interpolation     string `json:"defaultInterpolationMethod"`
			NativeBoundingBox struct {
				MinX float64     `json:"minx"`
				MinY float64     `json:"miny"`
				MaxX float64     `json:"maxx"`
				MaxY float64     `json:"maxy"`
				CRS  interface{} `json:"crs"`
			} `json:"nativeBoundingBox"`
			LatLonBoundingBox struct {
				MinX float64 `json:"minx"`
				MinY float64 `json:"miny"`
				MaxX float64 `json:"maxx"`
				MaxY float64 `json:"maxy"`
			} `json:"latLonBoundingBox"`
		} `json:"coverage"`
	}

	if err := json.Unmarshal(body, &covResult); err == nil && covResult.Coverage.Name != "" {
		cov := covResult.Coverage
		metadata.LayerTitle = cov.Title
		metadata.LayerAbstract = cov.Abstract
		metadata.LayerSRS = cov.SRS
		metadata.CoverageNativeFormat = cov.NativeFormat
		metadata.CoverageInterpolation = cov.Interpolation
		metadata.LayerKeywords = cov.Keywords.String

		switch v := cov.NativeCRS.(type) {
		case string:
			metadata.LayerNativeCRS = v
		case map[string]interface{}:
			if wkt, ok := v["$"].(string); ok {
				metadata.LayerNativeCRS = wkt
			}
		}

		for _, dim := range cov.Dimensions.CoverageDimension {
			metadata.CoverageDimensions = append(metadata.CoverageDimensions, dim.Name)
		}

		metadata.NativeBBox.MinX = cov.NativeBoundingBox.MinX
		metadata.NativeBBox.MinY = cov.NativeBoundingBox.MinY
		metadata.NativeBBox.MaxX = cov.NativeBoundingBox.MaxX
		metadata.NativeBBox.MaxY = cov.NativeBoundingBox.MaxY

		switch v := cov.NativeBoundingBox.CRS.(type) {
		case string:
			metadata.NativeBBox.CRS = v
		case map[string]interface{}:
			if code, ok := v["$"].(string); ok {
				metadata.NativeBBox.CRS = code
			}
		}

		metadata.LatLonBBox.MinX = cov.LatLonBoundingBox.MinX
		metadata.LatLonBBox.MinY = cov.LatLonBoundingBox.MinY
		metadata.LatLonBBox.MaxX = cov.LatLonBoundingBox.MaxX
		metadata.LatLonBBox.MaxY = cov.LatLonBoundingBox.MaxY
	}
}

// Update handles messages
func (d *InfoDialog) Update(msg tea.Msg) (*InfoDialog, tea.Cmd) {
	switch msg := msg.(type) {
	case InfoDialogAnimationMsg:
		if msg.ID != d.id {
			return d, nil
		}
		return d.updateAnimation()

	case InfoDialogMetadataMsg:
		if msg.ID != d.id {
			return d, nil
		}
		d.metadataLoading = false
		if msg.Error != nil {
			d.metadataError = msg.Error
		} else {
			d.extendedMetadata = msg.Metadata
		}
		return d, nil

	case tea.KeyMsg:
		if !d.visible || d.animating {
			return d, nil
		}

		switch msg.String() {
		case "esc", "enter", "i", "q", " ":
			return d, d.StartCloseAnimation()
		case "up", "k":
			if d.scrollOffset > 0 {
				d.scrollOffset--
			}
			return d, nil
		case "down", "j":
			if d.scrollOffset < d.maxScroll {
				d.scrollOffset++
			}
			return d, nil
		}
	}

	return d, nil
}

// updateAnimation updates the harmonica physics animation
func (d *InfoDialog) updateAnimation() (*InfoDialog, tea.Cmd) {
	if !d.animating {
		return d, nil
	}

	// Update scale using spring physics
	d.animScale, d.animVelocity = d.spring.Update(d.animScale, d.animVelocity, d.targetScale)

	// Update opacity - faster when closing
	opacityStep := 0.1
	if d.closing {
		opacityStep = 0.15 // Faster fade out
		d.animOpacity -= opacityStep
		if d.animOpacity < 0 {
			d.animOpacity = 0
		}
	} else {
		d.animOpacity += opacityStep
		if d.animOpacity > 1 {
			d.animOpacity = 1
		}
	}

	// Check if animation is complete - use more relaxed threshold when closing
	threshold := 0.01
	if d.closing {
		threshold = 0.05 // More relaxed threshold for faster closing
	}
	scaleClose := abs(d.animScale-d.targetScale) < threshold && abs(d.animVelocity) < threshold
	opacityClose := d.closing && d.animOpacity <= 0.01 || !d.closing && d.animOpacity >= 0.99

	if scaleClose && opacityClose {
		d.animating = false
		d.animScale = d.targetScale
		d.animOpacity = d.targetOpacity

		if d.closing {
			d.visible = false
			return d, nil
		}
	}

	return d, d.animateCmd()
}

// View renders the dialog with animation
func (d *InfoDialog) View() string {
	if !d.visible {
		return ""
	}

	dialogWidth := d.width/2 + 10
	if dialogWidth < 50 {
		dialogWidth = 50
	}
	if dialogWidth > 80 {
		dialogWidth = 80
	}

	scaledWidth := int(float64(dialogWidth) * d.animScale)
	if scaledWidth < 10 {
		scaledWidth = 10
	}

	dialogStyle := styles.DialogStyle.Width(scaledWidth)
	marginOffset := int((1.0 - d.animScale) * 5)
	dialogStyle = dialogStyle.MarginTop(marginOffset).MarginBottom(marginOffset)

	// When closing, render empty frame only
	if d.closing {
		dialog := dialogStyle.Render("")
		return styles.Center(d.width, d.height, dialog)
	}

	var b strings.Builder

	// Title with icon
	titleText := fmt.Sprintf("%s  %s", d.icon, d.title)
	title := styles.DialogTitleStyle.Render(titleText)
	b.WriteString(title)
	b.WriteString("\n\n")

	// Separator
	separator := styles.TreeBranchStyle.Render(strings.Repeat("─", 40))
	b.WriteString(separator)
	b.WriteString("\n\n")

	// Details
	maxLabelLen := 0
	for _, item := range d.details {
		if len(item.Label) > maxLabelLen {
			maxLabelLen = len(item.Label)
		}
	}

	// Extend with metadata labels
	extendedLabels := []string{"Title", "Abstract", "CRS", "Default Style", "Format", "File Path",
		"Store Enabled", "Layer Enabled", "Queryable", "Advertised", "Created", "Modified", "Keywords"}
	for _, label := range extendedLabels {
		if len(label) > maxLabelLen {
			maxLabelLen = len(label)
		}
	}

	for _, item := range d.details {
		label := styles.HelpKeyStyle.Width(maxLabelLen + 2).Render(item.Label + ":")

		valueStyle := item.Style
		if item.Style.Value() == "" {
			valueStyle = styles.ItemStyle
		}

		// Wrap long values
		maxValueWidth := 40
		value := item.Value
		if len(value) > maxValueWidth {
			value = wrapText(value, maxValueWidth)
		}

		renderedValue := valueStyle.Render(value)
		b.WriteString(fmt.Sprintf("  %s %s\n", label, renderedValue))
	}

	// Extended metadata section
	if d.metadataLoading {
		b.WriteString("\n")
		b.WriteString(styles.LoadingStyle.Render("  Loading extended metadata..."))
		b.WriteString("\n")
	} else if d.extendedMetadata != nil {
		m := d.extendedMetadata

		b.WriteString("\n")
		b.WriteString(styles.TreeBranchStyle.Render(strings.Repeat("─", 40)))
		b.WriteString("\n")

		// Check if this is server info (connection node) or layer/store metadata
		if m.ServerVersion != "" {
			b.WriteString(styles.DialogTitleStyle.Render("Server Status"))
			b.WriteString("\n\n")

			// GeoServer version
			d.renderMetadataItem(&b, "GeoServer", m.ServerVersion, maxLabelLen, styles.SuccessStyle)

			// GeoTools version
			if m.GeoToolsVersion != "" {
				d.renderMetadataItem(&b, "GeoTools", m.GeoToolsVersion, maxLabelLen, styles.ItemStyle)
			}

			// GeoWebCache version
			if m.GeoWebCacheVersion != "" {
				d.renderMetadataItem(&b, "GeoWebCache", m.GeoWebCacheVersion, maxLabelLen, styles.ItemStyle)
			}

			// Build timestamp
			if m.ServerBuild != "" {
				build := formatTimestamp(m.ServerBuild)
				d.renderMetadataItem(&b, "Build Time", build, maxLabelLen, styles.MutedStyle)
			}

			// Git revision
			if m.ServerRevision != "" {
				revision := m.ServerRevision
				if len(revision) > 12 {
					revision = revision[:12]
				}
				d.renderMetadataItem(&b, "Revision", revision, maxLabelLen, styles.MutedStyle)
			}
		} else {
			b.WriteString(styles.DialogTitleStyle.Render("Extended Metadata"))
			b.WriteString("\n\n")

			// Title
			if m.LayerTitle != "" {
				d.renderMetadataItem(&b, "Title", m.LayerTitle, maxLabelLen, styles.ItemStyle)
			}

			// Abstract
			if m.LayerAbstract != "" {
				abstractShort := m.LayerAbstract
				if len(abstractShort) > 60 {
					abstractShort = abstractShort[:57] + "..."
				}
				d.renderMetadataItem(&b, "Abstract", abstractShort, maxLabelLen, styles.MutedStyle)
			}

			// CRS
			if m.LayerSRS != "" {
				d.renderMetadataItem(&b, "CRS", m.LayerSRS, maxLabelLen, styles.ItemStyle)
			}

			// Default Style
			if m.LayerDefaultStyle != "" {
				d.renderMetadataItem(&b, "Default Style", m.LayerDefaultStyle, maxLabelLen, styles.ItemStyle)
			}

			// Store Format
			if m.StoreFormat != "" {
				d.renderMetadataItem(&b, "Format", m.StoreFormat, maxLabelLen, styles.ItemStyle)
			}

			// Coverage format
			if m.CoverageNativeFormat != "" {
				d.renderMetadataItem(&b, "Native Format", m.CoverageNativeFormat, maxLabelLen, styles.ItemStyle)
			}

			// File path
			if m.StoreURL != "" {
				filePath := m.StoreURL
				if strings.HasPrefix(filePath, "file:") {
					filePath = strings.TrimPrefix(filePath, "file:")
				}
				if len(filePath) > 40 {
					filePath = "..." + filePath[len(filePath)-37:]
				}
				d.renderMetadataItem(&b, "File Path", filePath, maxLabelLen, styles.MutedStyle)
			}

			// Status flags
			enabledStyle := styles.SuccessStyle
			disabledStyle := styles.ErrorStyle

			storeEnabledStyle := enabledStyle
			if !m.StoreEnabled {
				storeEnabledStyle = disabledStyle
			}
			d.renderMetadataItem(&b, "Store Enabled", boolToYesNo(m.StoreEnabled), maxLabelLen, storeEnabledStyle)

			layerEnabledStyle := enabledStyle
			if !m.LayerEnabled {
				layerEnabledStyle = disabledStyle
			}
			d.renderMetadataItem(&b, "Layer Enabled", boolToYesNo(m.LayerEnabled), maxLabelLen, layerEnabledStyle)

			queryableStyle := enabledStyle
			if !m.LayerQueryable {
				queryableStyle = disabledStyle
			}
			d.renderMetadataItem(&b, "Queryable", boolToYesNo(m.LayerQueryable), maxLabelLen, queryableStyle)

			advertisedStyle := enabledStyle
			if !m.LayerAdvertised {
				advertisedStyle = disabledStyle
			}
			d.renderMetadataItem(&b, "Advertised", boolToYesNo(m.LayerAdvertised), maxLabelLen, advertisedStyle)

			// Timestamps
			if m.DateCreated != "" {
				created := formatTimestamp(m.DateCreated)
				d.renderMetadataItem(&b, "Created", created, maxLabelLen, styles.MutedStyle)
			}

			if m.DateModified != "" {
				modified := formatTimestamp(m.DateModified)
				d.renderMetadataItem(&b, "Modified", modified, maxLabelLen, styles.MutedStyle)
			}

			// Keywords
			if len(m.LayerKeywords) > 0 {
				keywords := strings.Join(m.LayerKeywords, ", ")
				if len(keywords) > 40 {
					keywords = keywords[:37] + "..."
				}
				d.renderMetadataItem(&b, "Keywords", keywords, maxLabelLen, styles.MutedStyle)
			}

			// Bounding box
			if m.LatLonBBox.MinX != 0 || m.LatLonBBox.MaxX != 0 {
				bbox := fmt.Sprintf("%.4f, %.4f → %.4f, %.4f",
					m.LatLonBBox.MinX, m.LatLonBBox.MinY,
					m.LatLonBBox.MaxX, m.LatLonBBox.MaxY)
				d.renderMetadataItem(&b, "Lat/Lon BBox", bbox, maxLabelLen, styles.MutedStyle)
			}

			// Coverage dimensions
			if len(m.CoverageDimensions) > 0 {
				dims := strings.Join(m.CoverageDimensions, ", ")
				d.renderMetadataItem(&b, "Bands", dims, maxLabelLen, styles.ItemStyle)
			}
		}
	}

	b.WriteString("\n")

	// Help text
	helpText := "Press any key to close"
	if d.maxScroll > 0 {
		helpText = "↑/↓ scroll • " + helpText
	}
	b.WriteString(styles.HelpTextStyle.Render(helpText))

	dialog := dialogStyle.Render(b.String())

	// Apply opacity effect
	if d.animOpacity < 1.0 && d.animOpacity > 0.5 {
		dialog = lipgloss.NewStyle().Render(dialog)
	} else if d.animOpacity <= 0.5 {
		fadedStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#666666"))
		dialog = fadedStyle.Render(dialog)
	}

	return styles.Center(d.width, d.height, dialog)
}

// renderMetadataItem renders a single metadata item
func (d *InfoDialog) renderMetadataItem(b *strings.Builder, label, value string, maxLabelLen int, valueStyle lipgloss.Style) {
	labelRendered := styles.HelpKeyStyle.Width(maxLabelLen + 2).Render(label + ":")
	valueRendered := valueStyle.Render(value)
	b.WriteString(fmt.Sprintf("  %s %s\n", labelRendered, valueRendered))
}

// boolToYesNo converts a boolean to "Yes" or "No"
func boolToYesNo(b bool) string {
	if b {
		return "Yes"
	}
	return "No"
}

// formatTimestamp formats a timestamp string
func formatTimestamp(ts string) string {
	// Try to parse and format the timestamp
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, ts); err == nil {
			return t.Format("2006-01-02 15:04")
		}
	}
	return ts
}

// wrapText wraps text to a maximum width
func wrapText(text string, maxWidth int) string {
	if len(text) <= maxWidth {
		return text
	}

	var result strings.Builder
	words := strings.Fields(text)
	currentLine := ""

	for _, word := range words {
		if len(currentLine)+len(word)+1 <= maxWidth {
			if currentLine != "" {
				currentLine += " "
			}
			currentLine += word
		} else {
			if currentLine != "" {
				result.WriteString(currentLine + "\n")
			}
			currentLine = word
		}
	}

	if currentLine != "" {
		result.WriteString(currentLine)
	}

	return result.String()
}
