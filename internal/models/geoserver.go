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

// DataStoreType represents the type of data store
type DataStoreType int

const (
	DataStoreTypePostGIS DataStoreType = iota
	DataStoreTypeShapefileDir
	DataStoreTypeGeoPackage
	DataStoreTypeWFS
)

// String returns the display name for the data store type
func (d DataStoreType) String() string {
	switch d {
	case DataStoreTypePostGIS:
		return "PostGIS"
	case DataStoreTypeShapefileDir:
		return "Directory of Shapefiles"
	case DataStoreTypeGeoPackage:
		return "GeoPackage"
	case DataStoreTypeWFS:
		return "Web Feature Service (WFS)"
	default:
		return "Unknown"
	}
}

// DBType returns the GeoServer dbtype value
func (d DataStoreType) DBType() string {
	switch d {
	case DataStoreTypePostGIS:
		return "postgis"
	case DataStoreTypeShapefileDir:
		return "Directory of spatial files (shapefiles)"
	case DataStoreTypeGeoPackage:
		return "geopkg"
	case DataStoreTypeWFS:
		return "wfs"
	default:
		return ""
	}
}

// DataStoreField represents a field in the data store configuration
type DataStoreField struct {
	Name        string
	Label       string
	Placeholder string
	Required    bool
	Password    bool
	Default     string
}

// GetDataStoreFields returns the configuration fields for a data store type
func GetDataStoreFields(storeType DataStoreType) []DataStoreField {
	switch storeType {
	case DataStoreTypePostGIS:
		return []DataStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-postgis-store", Required: true},
			{Name: "host", Label: "Host", Placeholder: "localhost", Required: true, Default: "localhost"},
			{Name: "port", Label: "Port", Placeholder: "5432", Required: true, Default: "5432"},
			{Name: "database", Label: "Database", Placeholder: "geodata", Required: true},
			{Name: "schema", Label: "Schema", Placeholder: "public", Required: false, Default: "public"},
			{Name: "user", Label: "Username", Placeholder: "postgres", Required: true},
			{Name: "passwd", Label: "Password", Placeholder: "password", Required: true, Password: true},
		}
	case DataStoreTypeShapefileDir:
		return []DataStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-shapefile-store", Required: true},
			{Name: "url", Label: "Directory Path", Placeholder: "file:data/shapefiles", Required: true},
		}
	case DataStoreTypeGeoPackage:
		return []DataStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-geopackage-store", Required: true},
			{Name: "database", Label: "GeoPackage Path", Placeholder: "file:data/mydata.gpkg", Required: true},
		}
	case DataStoreTypeWFS:
		return []DataStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-wfs-store", Required: true},
			{Name: "WFSDataStoreFactory:GET_CAPABILITIES_URL", Label: "WFS URL", Placeholder: "https://example.com/wfs?service=WFS&request=GetCapabilities", Required: true},
			{Name: "WFSDataStoreFactory:USERNAME", Label: "Username", Placeholder: "user", Required: false},
			{Name: "WFSDataStoreFactory:PASSWORD", Label: "Password", Placeholder: "password", Required: false, Password: true},
		}
	default:
		return []DataStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "store-name", Required: true},
		}
	}
}

// GetAllDataStoreTypes returns all available data store types
func GetAllDataStoreTypes() []DataStoreType {
	return []DataStoreType{
		DataStoreTypePostGIS,
		DataStoreTypeShapefileDir,
		DataStoreTypeGeoPackage,
		DataStoreTypeWFS,
	}
}

// CoverageStoreType represents the type of coverage store
type CoverageStoreType int

const (
	CoverageStoreTypeGeoTIFF CoverageStoreType = iota
	CoverageStoreTypeWorldImage
	CoverageStoreTypeImageMosaic
	CoverageStoreTypeImagePyramid
	CoverageStoreTypeArcGrid
	CoverageStoreTypeGeoPackageRaster
)

// String returns the display name for the coverage store type
func (c CoverageStoreType) String() string {
	switch c {
	case CoverageStoreTypeGeoTIFF:
		return "GeoTIFF"
	case CoverageStoreTypeWorldImage:
		return "World Image (PNG/JPEG/GIF with world file)"
	case CoverageStoreTypeImageMosaic:
		return "Image Mosaic"
	case CoverageStoreTypeImagePyramid:
		return "Image Pyramid"
	case CoverageStoreTypeArcGrid:
		return "ArcGrid (ASCII Grid)"
	case CoverageStoreTypeGeoPackageRaster:
		return "GeoPackage (Raster)"
	default:
		return "Unknown"
	}
}

// Type returns the GeoServer type value
func (c CoverageStoreType) Type() string {
	switch c {
	case CoverageStoreTypeGeoTIFF:
		return "GeoTIFF"
	case CoverageStoreTypeWorldImage:
		return "WorldImage"
	case CoverageStoreTypeImageMosaic:
		return "ImageMosaic"
	case CoverageStoreTypeImagePyramid:
		return "ImagePyramid"
	case CoverageStoreTypeArcGrid:
		return "ArcGrid"
	case CoverageStoreTypeGeoPackageRaster:
		return "GeoPackage (mosaic)"
	default:
		return ""
	}
}

// CoverageStoreField represents a field in the coverage store configuration
type CoverageStoreField struct {
	Name        string
	Label       string
	Placeholder string
	Required    bool
}

// GetCoverageStoreFields returns the configuration fields for a coverage store type
func GetCoverageStoreFields(storeType CoverageStoreType) []CoverageStoreField {
	switch storeType {
	case CoverageStoreTypeGeoTIFF:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-geotiff-store", Required: true},
			{Name: "url", Label: "File Path", Placeholder: "file:data/raster.tif", Required: true},
		}
	case CoverageStoreTypeWorldImage:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-image-store", Required: true},
			{Name: "url", Label: "File Path", Placeholder: "file:data/image.png", Required: true},
		}
	case CoverageStoreTypeImageMosaic:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-mosaic-store", Required: true},
			{Name: "url", Label: "Directory Path", Placeholder: "file:data/mosaic", Required: true},
		}
	case CoverageStoreTypeImagePyramid:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-pyramid-store", Required: true},
			{Name: "url", Label: "Directory Path", Placeholder: "file:data/pyramid", Required: true},
		}
	case CoverageStoreTypeArcGrid:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-arcgrid-store", Required: true},
			{Name: "url", Label: "File Path", Placeholder: "file:data/grid.asc", Required: true},
		}
	case CoverageStoreTypeGeoPackageRaster:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "my-gpkg-raster-store", Required: true},
			{Name: "url", Label: "GeoPackage Path", Placeholder: "file:data/raster.gpkg", Required: true},
		}
	default:
		return []CoverageStoreField{
			{Name: "name", Label: "Store Name", Placeholder: "store-name", Required: true},
			{Name: "url", Label: "File/Directory Path", Placeholder: "file:data/...", Required: true},
		}
	}
}

// GetAllCoverageStoreTypes returns all available coverage store types
func GetAllCoverageStoreTypes() []CoverageStoreType {
	return []CoverageStoreType{
		CoverageStoreTypeGeoTIFF,
		CoverageStoreTypeWorldImage,
		CoverageStoreTypeImageMosaic,
		CoverageStoreTypeImagePyramid,
		CoverageStoreTypeArcGrid,
		CoverageStoreTypeGeoPackageRaster,
	}
}
