package models

// NodeType represents the type of node in the GeoServer hierarchy
type NodeType int

const (
	NodeTypeRoot NodeType = iota
	NodeTypeWorkspace
	NodeTypeDataStores
	NodeTypeCoverageStores
	NodeTypeWMSStores
	NodeTypeWMTSStores
	NodeTypeDataStore
	NodeTypeCoverageStore
	NodeTypeWMSStore
	NodeTypeWMTSStore
	NodeTypeLayers
	NodeTypeLayer
	NodeTypeStyles
	NodeTypeStyle
	NodeTypeLayerGroups
	NodeTypeLayerGroup
)

// String returns the string representation of a NodeType
func (n NodeType) String() string {
	switch n {
	case NodeTypeRoot:
		return "root"
	case NodeTypeWorkspace:
		return "workspace"
	case NodeTypeDataStores:
		return "datastores"
	case NodeTypeCoverageStores:
		return "coveragestores"
	case NodeTypeWMSStores:
		return "wmsstores"
	case NodeTypeWMTSStores:
		return "wmtsstores"
	case NodeTypeDataStore:
		return "datastore"
	case NodeTypeCoverageStore:
		return "coveragestore"
	case NodeTypeWMSStore:
		return "wmsstore"
	case NodeTypeWMTSStore:
		return "wmtsstore"
	case NodeTypeLayers:
		return "layers"
	case NodeTypeLayer:
		return "layer"
	case NodeTypeStyles:
		return "styles"
	case NodeTypeStyle:
		return "style"
	case NodeTypeLayerGroups:
		return "layergroups"
	case NodeTypeLayerGroup:
		return "layergroup"
	default:
		return "unknown"
	}
}

// Icon returns an appropriate icon for the node type
func (n NodeType) Icon() string {
	switch n {
	case NodeTypeRoot:
		return "🌍"
	case NodeTypeWorkspace:
		return "📁"
	case NodeTypeDataStores:
		return "💾"
	case NodeTypeCoverageStores:
		return "🖼️"
	case NodeTypeWMSStores:
		return "🗺️"
	case NodeTypeWMTSStores:
		return "🔲"
	case NodeTypeDataStore:
		return "🗃️"
	case NodeTypeCoverageStore:
		return "📷"
	case NodeTypeWMSStore:
		return "🌐"
	case NodeTypeWMTSStore:
		return "📐"
	case NodeTypeLayers:
		return "📑"
	case NodeTypeLayer:
		return "📄"
	case NodeTypeStyles:
		return "🎨"
	case NodeTypeStyle:
		return "🖌️"
	case NodeTypeLayerGroups:
		return "📚"
	case NodeTypeLayerGroup:
		return "📘"
	default:
		return "❓"
	}
}

// TreeNode represents a node in the GeoServer hierarchy tree
type TreeNode struct {
	Name       string
	Type       NodeType
	Expanded   bool
	Children   []*TreeNode
	Parent     *TreeNode
	Workspace  string // The workspace this node belongs to
	StoreName  string // The store name (for layers)
	IsLoading  bool
	IsLoaded   bool
	HasError   bool
	ErrorMsg   string
}

// NewTreeNode creates a new tree node
func NewTreeNode(name string, nodeType NodeType) *TreeNode {
	return &TreeNode{
		Name:     name,
		Type:     nodeType,
		Children: make([]*TreeNode, 0),
	}
}

// AddChild adds a child node
func (n *TreeNode) AddChild(child *TreeNode) {
	child.Parent = n
	n.Children = append(n.Children, child)
}

// Toggle expands or collapses the node
func (n *TreeNode) Toggle() {
	n.Expanded = !n.Expanded
}

// Path returns the full path of this node
func (n *TreeNode) Path() string {
	if n.Parent == nil || n.Parent.Type == NodeTypeRoot {
		return n.Name
	}
	return n.Parent.Path() + "/" + n.Name
}

// Workspace represents a GeoServer workspace
type Workspace struct {
	Name string `json:"name"`
	Href string `json:"href,omitempty"`
}

// DataStore represents a GeoServer data store
type DataStore struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Type      string `json:"type,omitempty"`
	Enabled   bool   `json:"enabled,omitempty"`
	Workspace string `json:"-"`
}

// CoverageStore represents a GeoServer coverage store
type CoverageStore struct {
	Name        string `json:"name"`
	Href        string `json:"href,omitempty"`
	Type        string `json:"type,omitempty"`
	Enabled     bool   `json:"enabled,omitempty"`
	Workspace   string `json:"-"`
	Description string `json:"description,omitempty"`
}

// Layer represents a GeoServer layer
type Layer struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Type      string `json:"type,omitempty"`
	Workspace string `json:"-"`
	Store     string `json:"-"`
}

// Style represents a GeoServer style
type Style struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Format    string `json:"format,omitempty"`
	Workspace string `json:"-"`
}

// LayerGroup represents a GeoServer layer group
type LayerGroup struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Workspace string `json:"-"`
}

// FeatureType represents a GeoServer feature type
type FeatureType struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Workspace string `json:"-"`
	Store     string `json:"-"`
}

// Coverage represents a GeoServer coverage
type Coverage struct {
	Name      string `json:"name"`
	Href      string `json:"href,omitempty"`
	Workspace string `json:"-"`
	Store     string `json:"-"`
}

// FileType represents the type of local file
type FileType int

const (
	FileTypeDirectory FileType = iota
	FileTypeShapefile
	FileTypeGeoPackage
	FileTypeGeoTIFF
	FileTypeGeoJSON
	FileTypeSLD
	FileTypeCSS
	FileTypeOther
)

// String returns the string representation of a FileType
func (f FileType) String() string {
	switch f {
	case FileTypeDirectory:
		return "directory"
	case FileTypeShapefile:
		return "shapefile"
	case FileTypeGeoPackage:
		return "geopackage"
	case FileTypeGeoTIFF:
		return "geotiff"
	case FileTypeGeoJSON:
		return "geojson"
	case FileTypeSLD:
		return "sld"
	case FileTypeCSS:
		return "css"
	default:
		return "other"
	}
}

// Icon returns an appropriate icon for the file type
func (f FileType) Icon() string {
	switch f {
	case FileTypeDirectory:
		return "📁"
	case FileTypeShapefile:
		return "🗺️"
	case FileTypeGeoPackage:
		return "📦"
	case FileTypeGeoTIFF:
		return "🖼️"
	case FileTypeGeoJSON:
		return "📄"
	case FileTypeSLD:
		return "🎨"
	case FileTypeCSS:
		return "🎨"
	default:
		return "📄"
	}
}

// CanUpload returns true if this file type can be uploaded to GeoServer
func (f FileType) CanUpload() bool {
	switch f {
	case FileTypeShapefile, FileTypeGeoPackage, FileTypeGeoTIFF, FileTypeGeoJSON, FileTypeSLD, FileTypeCSS:
		return true
	default:
		return false
	}
}

// LocalFile represents a file in the local file system
type LocalFile struct {
	Name     string
	Path     string
	Type     FileType
	Size     int64
	IsDir    bool
	Selected bool
}
