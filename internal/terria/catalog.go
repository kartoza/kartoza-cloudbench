// Package terria provides TerriaJS catalog generation and integration
package terria

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kartoza/kartoza-geoserver-client/internal/api"
	"github.com/kartoza/kartoza-geoserver-client/internal/config"
	"github.com/kartoza/kartoza-geoserver-client/internal/models"
)

// CatalogVersion is the TerriaJS catalog version
const CatalogVersion = "8.0.0"

// InitFile represents a TerriaJS initialization file
type InitFile struct {
	Catalog     []CatalogMember `json:"catalog"`
	HomeCamera  *Camera         `json:"homeCamera,omitempty"`
	BaseMaps    *BaseMaps       `json:"baseMaps,omitempty"`
	ViewerMode  string          `json:"viewerMode,omitempty"` // "3d", "2d", "3dSmooth"
	CORSDomains []string        `json:"corsDomains,omitempty"`
}

// Camera represents a Terria camera position
type Camera struct {
	North     float64 `json:"north,omitempty"`
	South     float64 `json:"south,omitempty"`
	East      float64 `json:"east,omitempty"`
	West      float64 `json:"west,omitempty"`
	Position  *XYZ    `json:"position,omitempty"`
	Direction *XYZ    `json:"direction,omitempty"`
	Up        *XYZ    `json:"up,omitempty"`
}

// XYZ represents 3D coordinates
type XYZ struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// BaseMaps represents base map configuration
type BaseMaps struct {
	DefaultBaseMapId string        `json:"defaultBaseMapId,omitempty"`
	PreviewBaseMapId string        `json:"previewBaseMapId,omitempty"`
	Items            []BaseMapItem `json:"items,omitempty"`
}

// BaseMapItem represents a base map item
type BaseMapItem struct {
	Item    CatalogMember `json:"item"`
	Image   string        `json:"image,omitempty"`
	ContrastColor string  `json:"contrastColor,omitempty"`
}

// CatalogMember is an interface for all catalog member types
type CatalogMember interface {
	GetType() string
}

// CatalogGroup represents a group/folder in the catalog
type CatalogGroup struct {
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	ID          string          `json:"id,omitempty"`
	Description string          `json:"description,omitempty"`
	IsOpen      bool            `json:"isOpen,omitempty"`
	Members     []CatalogMember `json:"members,omitempty"`
}

func (g *CatalogGroup) GetType() string { return g.Type }

// MarshalJSON implements custom JSON marshaling for CatalogGroup
func (g *CatalogGroup) MarshalJSON() ([]byte, error) {
	type Alias CatalogGroup
	return json.Marshal(&struct {
		*Alias
		Members []json.RawMessage `json:"members,omitempty"`
	}{
		Alias:   (*Alias)(g),
		Members: marshalMembers(g.Members),
	})
}

// WMSCatalogItem represents a WMS layer in the catalog
type WMSCatalogItem struct {
	Type                 string   `json:"type"`
	Name                 string   `json:"name"`
	ID                   string   `json:"id,omitempty"`
	Description          string   `json:"description,omitempty"`
	URL                  string   `json:"url"`
	Layers               string   `json:"layers"`
	Styles               string   `json:"styles,omitempty"`
	Parameters           *WMSParams `json:"parameters,omitempty"`
	GetFeatureInfoFormat string   `json:"getFeatureInfoFormat,omitempty"`
	MinScaleDenominator  float64  `json:"minScaleDenominator,omitempty"`
	MaxScaleDenominator  float64  `json:"maxScaleDenominator,omitempty"`
	IsGeoServer          bool     `json:"isGeoServer,omitempty"`
	Opacity              float64  `json:"opacity,omitempty"`
	InitialMessage       *Message `json:"initialMessage,omitempty"`
	Info                 []Info   `json:"info,omitempty"`
	Rectangle            *Rect    `json:"rectangle,omitempty"`
}

func (w *WMSCatalogItem) GetType() string { return w.Type }

// WMSParams represents WMS request parameters
type WMSParams struct {
	Transparent bool   `json:"transparent,omitempty"`
	Format      string `json:"format,omitempty"`
	Tiled       bool   `json:"tiled,omitempty"`
}

// WFSCatalogItem represents a WFS layer in the catalog
type WFSCatalogItem struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	ID          string `json:"id,omitempty"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url"`
	TypeNames   string `json:"typeNames"`
	MaxFeatures int    `json:"maxFeatures,omitempty"`
	Rectangle   *Rect  `json:"rectangle,omitempty"`
}

func (w *WFSCatalogItem) GetType() string { return w.Type }

// WMSCatalogGroup represents a WMS server that auto-discovers layers
type WMSCatalogGroup struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	ID          string `json:"id,omitempty"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url"`
	IsOpen      bool   `json:"isOpen,omitempty"`
}

func (w *WMSCatalogGroup) GetType() string { return w.Type }

// Message represents a user message
type Message struct {
	Title   string `json:"title,omitempty"`
	Content string `json:"content,omitempty"`
}

// Info represents metadata info
type Info struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// Rect represents a bounding rectangle
type Rect struct {
	West  float64 `json:"west"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	North float64 `json:"north"`
}

// StartData represents the data for a Terria start URL parameter
type StartData struct {
	Version     string     `json:"version"`
	InitSources []InitSource `json:"initSources"`
}

// InitSource can be a string (URL) or an inline init file
type InitSource struct {
	URL      string    `json:"url,omitempty"`
	Catalog  []CatalogMember `json:"catalog,omitempty"`
	HomeCamera *Camera  `json:"homeCamera,omitempty"`
	Workbench []string `json:"workbench,omitempty"`
}

// marshalMembers converts CatalogMember slice to raw JSON
func marshalMembers(members []CatalogMember) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(members))
	for _, m := range members {
		if m == nil {
			continue
		}
		data, err := json.Marshal(m)
		if err == nil {
			result = append(result, data)
		}
	}
	return result
}

// Exporter generates Terria catalogs from GeoServer resources
type Exporter struct {
	client     *api.Client
	connection *config.Connection
	proxyURL   string // Optional proxy URL for CORS
}

// NewExporter creates a new Terria catalog exporter
func NewExporter(client *api.Client, conn *config.Connection) *Exporter {
	return &Exporter{
		client:     client,
		connection: conn,
	}
}

// SetProxyURL sets the proxy URL for CORS support
func (e *Exporter) SetProxyURL(proxyURL string) {
	e.proxyURL = proxyURL
}

// getWMSURL returns the WMS URL, optionally proxied
func (e *Exporter) getWMSURL(workspace string) string {
	baseURL := strings.TrimSuffix(e.connection.URL, "/")
	wmsURL := fmt.Sprintf("%s/%s/wms", baseURL, workspace)
	if e.proxyURL != "" {
		return fmt.Sprintf("%s?url=%s", e.proxyURL, wmsURL)
	}
	return wmsURL
}

// getWFSURL returns the WFS URL, optionally proxied
func (e *Exporter) getWFSURL(workspace string) string {
	baseURL := strings.TrimSuffix(e.connection.URL, "/")
	wfsURL := fmt.Sprintf("%s/%s/wfs", baseURL, workspace)
	if e.proxyURL != "" {
		return fmt.Sprintf("%s?url=%s", e.proxyURL, wfsURL)
	}
	return wfsURL
}

// ExportWorkspace exports a workspace as a Terria catalog group
func (e *Exporter) ExportWorkspace(workspace string) (*CatalogGroup, error) {
	group := &CatalogGroup{
		Type:        "group",
		Name:        workspace,
		ID:          fmt.Sprintf("%s-%s", e.connection.ID, workspace),
		Description: fmt.Sprintf("Workspace %s from %s", workspace, e.connection.Name),
		IsOpen:      true,
		Members:     []CatalogMember{},
	}

	// Get layers in the workspace
	layers, err := e.client.GetLayers(workspace)
	if err != nil {
		return nil, fmt.Errorf("failed to get layers: %w", err)
	}

	wmsURL := e.getWMSURL(workspace)

	for _, layer := range layers {
		// Get layer metadata for bounding box
		layerMeta, _ := e.client.GetLayerMetadata(workspace, layer.Name)

		wmsItem := &WMSCatalogItem{
			Type:        "wms",
			Name:        layer.Name,
			ID:          fmt.Sprintf("%s-%s-%s", e.connection.ID, workspace, layer.Name),
			URL:         wmsURL,
			Layers:      fmt.Sprintf("%s:%s", workspace, layer.Name),
			IsGeoServer: true,
			Parameters: &WMSParams{
				Transparent: true,
				Format:      "image/png",
				Tiled:       true,
			},
			GetFeatureInfoFormat: "application/json",
		}

		// Add bounding box if available (use LatLonBoundingBox for Terria)
		if layerMeta != nil && layerMeta.LatLonBoundingBox != nil {
			wmsItem.Rectangle = &Rect{
				West:  layerMeta.LatLonBoundingBox.MinX,
				South: layerMeta.LatLonBoundingBox.MinY,
				East:  layerMeta.LatLonBoundingBox.MaxX,
				North: layerMeta.LatLonBoundingBox.MaxY,
			}
		}

		group.Members = append(group.Members, wmsItem)
	}

	return group, nil
}

// ExportLayer exports a single layer as a Terria WMS item
func (e *Exporter) ExportLayer(workspace, layerName string) (*WMSCatalogItem, error) {
	layerMeta, err := e.client.GetLayerMetadata(workspace, layerName)
	if err != nil {
		// If metadata fetch fails, still create basic item
		layerMeta = nil
	}

	wmsURL := e.getWMSURL(workspace)

	item := &WMSCatalogItem{
		Type:        "wms",
		Name:        layerName,
		ID:          fmt.Sprintf("%s-%s-%s", e.connection.ID, workspace, layerName),
		URL:         wmsURL,
		Layers:      fmt.Sprintf("%s:%s", workspace, layerName),
		IsGeoServer: true,
		Parameters: &WMSParams{
			Transparent: true,
			Format:      "image/png",
			Tiled:       true,
		},
		GetFeatureInfoFormat: "application/json",
	}

	// Add bounding box if available (use LatLonBoundingBox for Terria)
	if layerMeta != nil && layerMeta.LatLonBoundingBox != nil {
		item.Rectangle = &Rect{
			West:  layerMeta.LatLonBoundingBox.MinX,
			South: layerMeta.LatLonBoundingBox.MinY,
			East:  layerMeta.LatLonBoundingBox.MaxX,
			North: layerMeta.LatLonBoundingBox.MaxY,
		}
	}

	// Add description if available
	if layerMeta != nil && layerMeta.Title != "" {
		item.Description = layerMeta.Title
	}

	return item, nil
}

// ExportLayerGroup exports a layer group as a Terria WMS item
func (e *Exporter) ExportLayerGroup(workspace, groupName string) (*WMSCatalogItem, error) {
	groupDetail, err := e.client.GetLayerGroup(workspace, groupName)
	if err != nil {
		return nil, fmt.Errorf("failed to get layer group details: %w", err)
	}

	wmsURL := e.getWMSURL(workspace)

	item := &WMSCatalogItem{
		Type:        "wms",
		Name:        groupName,
		ID:          fmt.Sprintf("%s-%s-group-%s", e.connection.ID, workspace, groupName),
		URL:         wmsURL,
		Layers:      fmt.Sprintf("%s:%s", workspace, groupName),
		IsGeoServer: true,
		Parameters: &WMSParams{
			Transparent: true,
			Format:      "image/png",
			Tiled:       true,
		},
	}

	// Add bounding box if available
	if groupDetail != nil && groupDetail.Bounds != nil {
		item.Rectangle = &Rect{
			West:  groupDetail.Bounds.MinX,
			South: groupDetail.Bounds.MinY,
			East:  groupDetail.Bounds.MaxX,
			North: groupDetail.Bounds.MaxY,
		}
	}

	// Add description
	if groupDetail != nil && groupDetail.Title != "" {
		item.Description = groupDetail.Title
	}

	return item, nil
}

// ExportConnection exports all workspaces from a connection
func (e *Exporter) ExportConnection() (*CatalogGroup, error) {
	group := &CatalogGroup{
		Type:        "group",
		Name:        e.connection.Name,
		ID:          e.connection.ID,
		Description: fmt.Sprintf("GeoServer at %s", e.connection.URL),
		IsOpen:      true,
		Members:     []CatalogMember{},
	}

	// Get all workspaces
	workspaces, err := e.client.GetWorkspaces()
	if err != nil {
		return nil, fmt.Errorf("failed to get workspaces: %w", err)
	}

	for _, ws := range workspaces {
		wsGroup, err := e.ExportWorkspace(ws.Name)
		if err != nil {
			continue // Skip workspaces that fail
		}
		if len(wsGroup.Members) > 0 {
			group.Members = append(group.Members, wsGroup)
		}
	}

	return group, nil
}

// ExportToInitFile creates a complete Terria init file
func (e *Exporter) ExportToInitFile(members []CatalogMember) *InitFile {
	return &InitFile{
		Catalog:    members,
		ViewerMode: "2d",
		CORSDomains: []string{
			strings.TrimPrefix(strings.TrimPrefix(e.connection.URL, "https://"), "http://"),
		},
	}
}

// GenerateStartURL generates a Terria start URL parameter for embedding catalog
func GenerateStartURL(members []CatalogMember, homeCamera *Camera, workbench []string) (*StartData, error) {
	return &StartData{
		Version: CatalogVersion,
		InitSources: []InitSource{
			{
				Catalog:    members,
				HomeCamera: homeCamera,
				Workbench:  workbench,
			},
		},
	}, nil
}

// ExportLayerGroupAsStory exports a layer group as a Terria "story" with individual layers
func (e *Exporter) ExportLayerGroupAsStory(workspace, groupName string) (*InitFile, error) {
	groupDetail, err := e.client.GetLayerGroup(workspace, groupName)
	if err != nil {
		return nil, fmt.Errorf("failed to get layer group: %w", err)
	}

	// Create a group containing individual layers
	storyGroup := &CatalogGroup{
		Type:        "group",
		Name:        groupName,
		ID:          fmt.Sprintf("story-%s-%s", workspace, groupName),
		Description: groupDetail.Title,
		IsOpen:      true,
		Members:     []CatalogMember{},
	}

	wmsURL := e.getWMSURL(workspace)

	// Add each layer in the group as a separate WMS item
	for _, layer := range groupDetail.Layers {
		layerName := layer.Name
		// Strip workspace prefix if present
		if strings.Contains(layerName, ":") {
			parts := strings.SplitN(layerName, ":", 2)
			layerName = parts[1]
		}

		item := &WMSCatalogItem{
			Type:        "wms",
			Name:        layerName,
			ID:          fmt.Sprintf("story-%s-%s-%s", workspace, groupName, layerName),
			URL:         wmsURL,
			Layers:      layer.Name,
			IsGeoServer: true,
			Parameters: &WMSParams{
				Transparent: true,
				Format:      "image/png",
			},
		}

		// Apply style if specified
		if layer.StyleName != "" {
			item.Styles = layer.StyleName
		}

		storyGroup.Members = append(storyGroup.Members, item)
	}

	// Create init file with home camera centered on the layer group
	initFile := &InitFile{
		Catalog:    []CatalogMember{storyGroup},
		ViewerMode: "2d",
	}

	// Set home camera if bounds available
	if groupDetail.Bounds != nil {
		initFile.HomeCamera = &Camera{
			West:  groupDetail.Bounds.MinX,
			South: groupDetail.Bounds.MinY,
			East:  groupDetail.Bounds.MaxX,
			North: groupDetail.Bounds.MaxY,
		}
	}

	return initFile, nil
}

// TreeNodeToTerriaCatalog converts a tree node to appropriate Terria catalog item
func (e *Exporter) TreeNodeToTerriaCatalog(node *models.TreeNode) (CatalogMember, error) {
	switch node.Type {
	case models.NodeTypeWorkspace:
		return e.ExportWorkspace(node.Name)
	case models.NodeTypeLayer:
		return e.ExportLayer(node.Workspace, node.Name)
	case models.NodeTypeLayerGroup:
		return e.ExportLayerGroup(node.Workspace, node.Name)
	default:
		return nil, fmt.Errorf("unsupported node type: %s", node.Type)
	}
}
