package models

// NodeType represents the type of node in the application hierarchy
type NodeType int

const (
	NodeTypeRoot NodeType = iota
	NodeTypeCloudBenchRoot  // Application root: "Kartoza CloudBench"
	NodeTypeGeoServerRoot   // "GeoServer" container
	NodeTypePostgreSQLRoot  // "PostgreSQL" container
	NodeTypeS3Root          // "S3 Storage" container
	NodeTypeConnection      // A GeoServer connection (server)
	NodeTypePGService       // pg_service.conf entry
	NodeTypePGSchema        // PostgreSQL schema
	NodeTypePGTable         // Database table
	NodeTypePGView          // Database view
	NodeTypePGColumn        // Table column
	NodeTypeS3Connection    // S3-compatible storage connection
	NodeTypeS3Bucket        // S3 bucket
	NodeTypeS3Folder        // Virtual folder (prefix) in S3
	NodeTypeS3Object        // S3 object (file)
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
	case NodeTypeCloudBenchRoot:
		return "cloudbench"
	case NodeTypeGeoServerRoot:
		return "geoserver"
	case NodeTypePostgreSQLRoot:
		return "postgresql"
	case NodeTypeS3Root:
		return "s3"
	case NodeTypeConnection:
		return "connection"
	case NodeTypePGService:
		return "pgservice"
	case NodeTypePGSchema:
		return "pgschema"
	case NodeTypePGTable:
		return "pgtable"
	case NodeTypePGView:
		return "pgview"
	case NodeTypePGColumn:
		return "pgcolumn"
	case NodeTypeS3Connection:
		return "s3connection"
	case NodeTypeS3Bucket:
		return "s3bucket"
	case NodeTypeS3Folder:
		return "s3folder"
	case NodeTypeS3Object:
		return "s3object"
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

// Icon returns an appropriate Nerd Font icon for the node type
// See: https://www.nerdfonts.com/cheat-sheet
func (n NodeType) Icon() string {
	switch n {
	case NodeTypeRoot:
		return "\uf0ac" // fa-globe
	case NodeTypeCloudBenchRoot:
		return "\uf0c2" // fa-cloud
	case NodeTypeGeoServerRoot:
		return "\uf0ac" // fa-globe
	case NodeTypePostgreSQLRoot:
		return "\uf472" // postgresql elephant icon
	case NodeTypeS3Root:
		return "\uf0c2" // fa-cloud
	case NodeTypeConnection:
		return "\uf233" // fa-server
	case NodeTypePGService:
		return "\uf1c0" // fa-database
	case NodeTypePGSchema:
		return "\uf07b" // fa-folder
	case NodeTypePGTable:
		return "\uf0ce" // fa-table
	case NodeTypePGView:
		return "\uf06e" // fa-eye
	case NodeTypePGColumn:
		return "\uf0db" // fa-columns
	case NodeTypeS3Connection:
		return "\uf0c2" // fa-cloud
	case NodeTypeS3Bucket:
		return "\uf1b2" // fa-cube (bucket)
	case NodeTypeS3Folder:
		return "\uf07b" // fa-folder
	case NodeTypeS3Object:
		return "\uf15b" // fa-file
	case NodeTypeWorkspace:
		return "\uf07b" // fa-folder
	case NodeTypeDataStores:
		return "\uf1b3" // fa-cubes
	case NodeTypeCoverageStores:
		return "\uf03e" // fa-image
	case NodeTypeWMSStores:
		return "\uf279" // fa-map
	case NodeTypeWMTSStores:
		return "\uf00a" // fa-th (grid)
	case NodeTypeDataStore:
		return "\uf1c0" // fa-database
	case NodeTypeCoverageStore:
		return "\uf03e" // fa-image
	case NodeTypeWMSStore:
		return "\uf279" // fa-map
	case NodeTypeWMTSStore:
		return "\uf00a" // fa-th (grid)
	case NodeTypeLayers:
		return "\uf5fd" // fa-layer-group
	case NodeTypeLayer:
		return "\uf5fd" // fa-layer-group
	case NodeTypeStyles:
		return "\uf53f" // fa-palette
	case NodeTypeStyle:
		return "\uf1fc" // fa-paint-brush
	case NodeTypeLayerGroups:
		return "\uf5db" // fa-books
	case NodeTypeLayerGroup:
		return "\uf02d" // fa-book
	default:
		return "\uf128" // fa-question
	}
}

// TreeNode represents a node in the application hierarchy tree
type TreeNode struct {
	Name         string
	Type         NodeType
	Expanded     bool
	Children     []*TreeNode
	Parent       *TreeNode
	ConnectionID string // The connection ID this node belongs to (for multi-connection support)
	Workspace    string // The workspace this node belongs to
	StoreName    string // The store name (for layers)
	StoreType    string // The store type ("datastore" or "coveragestore")
	IsLoading    bool
	IsLoaded     bool
	HasError     bool
	ErrorMsg     string
	Enabled      *bool // nil = unknown, true = enabled, false = disabled
	// PostgreSQL-specific fields
	PGServiceName string // pg_service.conf entry name
	PGSchemaName  string // PostgreSQL schema name
	PGTableName   string // PostgreSQL table name
	IsParsed      bool   // Whether the PG service has been parsed/harvested
	DataType      string // Column data type for PGColumn nodes
	// S3-specific fields
	S3ConnectionID string // S3 connection ID this node belongs to
	S3Bucket       string // S3 bucket name
	S3Key          string // S3 object key (path)
	S3Size         int64  // Object size in bytes
	S3ContentType  string // Content type of the object
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
	Name     string `json:"name"`
	Href     string `json:"href,omitempty"`
	Isolated bool   `json:"isolated,omitempty"`
}

// WorkspaceSettings represents workspace-specific settings
type WorkspaceSettings struct {
	Enabled bool   `json:"enabled,omitempty"`
	Name    string `json:"name,omitempty"`
}

// WorkspaceServiceSettings represents service-specific settings for a workspace
type WorkspaceServiceSettings struct {
	Enabled bool `json:"enabled"`
}

// WorkspaceConfig holds all configuration options for creating/editing a workspace
type WorkspaceConfig struct {
	Name             string
	Isolated         bool
	Default          bool
	Enabled          bool // Settings enabled
	WMTSEnabled      bool
	WMSEnabled       bool
	WCSEnabled       bool
	WPSEnabled       bool
	WFSEnabled       bool
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
	Enabled   *bool  `json:"enabled,omitempty"` // Pointer to detect if present in JSON
	Workspace string `json:"-"`
	Store     string `json:"-"`
}

// LayerConfig holds all configuration options for editing a layer
type LayerConfig struct {
	Name         string
	Workspace    string
	Store        string
	StoreType    string // "datastore" or "coveragestore"
	Enabled      bool
	Advertised   bool
	Queryable    bool   // Only for vector layers
	DefaultStyle string
}

// LayerMetadata holds comprehensive layer metadata for editing
type LayerMetadata struct {
	Name        string   `json:"name"`
	NativeName  string   `json:"nativeName,omitempty"`
	Workspace   string   `json:"workspace"`
	Store       string   `json:"store"`
	StoreType   string   `json:"storeType"` // "datastore" or "coveragestore"
	Title       string   `json:"title,omitempty"`
	Abstract    string   `json:"abstract,omitempty"`
	Keywords    []string `json:"keywords,omitempty"`
	NativeCRS   string   `json:"nativeCRS,omitempty"`
	SRS         string   `json:"srs,omitempty"`
	Enabled     bool     `json:"enabled"`
	Advertised  bool     `json:"advertised"`
	Queryable   bool     `json:"queryable"`
	// Bounding boxes
	NativeBoundingBox *BoundingBox `json:"nativeBoundingBox,omitempty"`
	LatLonBoundingBox *BoundingBox `json:"latLonBoundingBox,omitempty"`
	// Attribution
	AttributionTitle string `json:"attributionTitle,omitempty"`
	AttributionHref  string `json:"attributionHref,omitempty"`
	AttributionLogo  string `json:"attributionLogo,omitempty"`
	// Metadata links
	MetadataLinks []MetadataLink `json:"metadataLinks,omitempty"`
	// Default style
	DefaultStyle string `json:"defaultStyle,omitempty"`
	// Additional vector-specific fields
	MaxFeatures  int `json:"maxFeatures,omitempty"`
	NumDecimals  int `json:"numDecimals,omitempty"`
	OverridingServiceSRS bool `json:"overridingServiceSRS,omitempty"`
	SkipNumberMatch      bool `json:"skipNumberMatch,omitempty"`
	CircularArcPresent   bool `json:"circularArcPresent,omitempty"`
}

// BoundingBox represents a geographic bounding box
type BoundingBox struct {
	MinX float64 `json:"minx"`
	MinY float64 `json:"miny"`
	MaxX float64 `json:"maxx"`
	MaxY float64 `json:"maxy"`
	CRS  string  `json:"crs,omitempty"`
}

// MetadataLink represents a metadata link for a layer
type MetadataLink struct {
	Type         string `json:"type"`          // e.g., "text/html", "text/xml"
	MetadataType string `json:"metadataType"`  // e.g., "ISO19115:2003", "FGDC", "TC211"
	Content      string `json:"content"`       // URL
}

// LayerMetadataUpdate contains fields that can be updated
type LayerMetadataUpdate struct {
	Title            string         `json:"title,omitempty"`
	Abstract         string         `json:"abstract,omitempty"`
	Keywords         []string       `json:"keywords,omitempty"`
	SRS              string         `json:"srs,omitempty"`
	Enabled          *bool          `json:"enabled,omitempty"`
	Advertised       *bool          `json:"advertised,omitempty"`
	Queryable        *bool          `json:"queryable,omitempty"`
	AttributionTitle string         `json:"attributionTitle,omitempty"`
	AttributionHref  string         `json:"attributionHref,omitempty"`
	MetadataLinks    []MetadataLink `json:"metadataLinks,omitempty"`
}

// DataStoreConfig holds configuration options for editing a data store
type DataStoreConfig struct {
	Name        string
	Workspace   string
	Enabled     bool
	Description string
}

// CoverageStoreConfig holds configuration options for editing a coverage store
type CoverageStoreConfig struct {
	Name        string
	Workspace   string
	Enabled     bool
	Description string
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

// LayerStyleAssignment represents a layer with its assigned style for layer groups
type LayerStyleAssignment struct {
	LayerName string `json:"layerName"` // Layer name (workspace:layer format)
	StyleName string `json:"styleName"` // Style name (empty for default)
}

// LayerGroupCreate represents the data needed to create a layer group
type LayerGroupCreate struct {
	Name        string                 `json:"name"`
	Title       string                 `json:"title,omitempty"`
	Mode        string                 `json:"mode,omitempty"` // SINGLE, NAMED, CONTAINER, EO
	Layers      []string               `json:"layers"`         // List of layer names (workspace:layername format)
	LayerStyles []LayerStyleAssignment `json:"-"`              // Layer style assignments (used internally)
}

// LayerGroupDetails contains detailed information about a layer group
type LayerGroupDetails struct {
	Name        string           `json:"name"`
	Workspace   string           `json:"workspace,omitempty"`
	Mode        string           `json:"mode"`
	Title       string           `json:"title,omitempty"`
	Abstract    string           `json:"abstract,omitempty"`
	Layers      []LayerGroupItem `json:"layers"`
	Bounds      *Bounds          `json:"bounds,omitempty"`
	Enabled     bool             `json:"enabled"`
	Advertised  bool             `json:"advertised"`
}

// LayerGroupItem represents a layer or nested group within a layer group
type LayerGroupItem struct {
	Type      string `json:"type"`      // "layer" or "layerGroup"
	Name      string `json:"name"`
	StyleName string `json:"styleName,omitempty"`
}

// Bounds represents geographic bounds
type Bounds struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
	CRS  string  `json:"crs"`
}

// LayerGroupUpdate represents the data for updating a layer group
type LayerGroupUpdate struct {
	Title       string                 `json:"title,omitempty"`
	Mode        string                 `json:"mode,omitempty"`
	Layers      []string               `json:"layers,omitempty"`
	LayerStyles []LayerStyleAssignment `json:"-"` // Layer style assignments (used internally)
	Enabled     bool                   `json:"enabled"`
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

// GWCLayer represents a GeoWebCache cached layer
type GWCLayer struct {
	Name       string   `json:"name"`
	Href       string   `json:"href,omitempty"`
	Enabled    bool     `json:"enabled"`
	GridSubsets []string `json:"gridSubsets,omitempty"`
	MimeFormats []string `json:"mimeFormats,omitempty"`
}

// GWCSeedRequest represents a seed/truncate request for GWC
type GWCSeedRequest struct {
	Name        string   `json:"name"`
	GridSetID   string   `json:"gridSetId"`
	ZoomStart   int      `json:"zoomStart"`
	ZoomStop    int      `json:"zoomStop"`
	Format      string   `json:"format"`
	Type        string   `json:"type"` // "seed", "reseed", or "truncate"
	ThreadCount int      `json:"threadCount"`
	Bounds      *GWCBounds `json:"bounds,omitempty"`
}

// GWCBounds represents geographic bounds for seeding
type GWCBounds struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
	SRS  string  `json:"srs"`
}

// GWCSeedTask represents a running or pending seed task
type GWCSeedTask struct {
	ID              int64  `json:"id"`
	TilesDone       int64  `json:"tilesDone"`
	TilesTotal      int64  `json:"tilesTotal"`
	TimeRemaining   int64  `json:"timeRemaining"` // in seconds, -1 if unknown
	Status          string `json:"status"`        // Running, Pending, Done, Aborted
	LayerName       string `json:"layerName"`
}

// GWCSeedStatus represents the status of all seeding tasks
type GWCSeedStatus struct {
	Tasks []GWCSeedTask `json:"tasks"`
}

// GWCGridSet represents a tile grid configuration
type GWCGridSet struct {
	Name        string  `json:"name"`
	SRS         string  `json:"srs"`
	TileWidth   int     `json:"tileWidth"`
	TileHeight  int     `json:"tileHeight"`
	MinX        float64 `json:"minX,omitempty"`
	MinY        float64 `json:"minY,omitempty"`
	MaxX        float64 `json:"maxX,omitempty"`
	MaxY        float64 `json:"maxY,omitempty"`
}

// GWCDiskQuota represents disk quota configuration
type GWCDiskQuota struct {
	Enabled          bool   `json:"enabled"`
	DiskBlockSize    int    `json:"diskBlockSize"`
	CacheCleanUpFreq int    `json:"cacheCleanUpFrequency"`
	MaxConcurrent    int    `json:"maxConcurrentCleanUps"`
	GlobalQuota      string `json:"globalQuota,omitempty"` // e.g., "500 MiB"
}

// GeoServerContact represents the GeoServer contact information
type GeoServerContact struct {
	// Contact person
	ContactPerson   string `json:"contactPerson,omitempty"`
	ContactPosition string `json:"contactPosition,omitempty"`

	// Organization
	ContactOrganization string `json:"contactOrganization,omitempty"`

	// Address
	AddressType     string `json:"addressType,omitempty"`
	Address         string `json:"address,omitempty"`
	AddressCity     string `json:"addressCity,omitempty"`
	AddressState    string `json:"addressState,omitempty"`
	AddressPostCode string `json:"addressPostalCode,omitempty"`
	AddressCountry  string `json:"addressCountry,omitempty"`

	// Contact details
	ContactVoice   string `json:"contactVoice,omitempty"`
	ContactFax     string `json:"contactFacsimile,omitempty"`
	ContactEmail   string `json:"contactEmail,omitempty"`

	// Online resources
	OnlineResource string `json:"onlineResource,omitempty"`
	Welcome        string `json:"welcome,omitempty"`
}

// GeoServerGlobalSettings represents the GeoServer global settings
type GeoServerGlobalSettings struct {
	// General settings
	Charset              string `json:"charset,omitempty"`
	NumDecimals          int    `json:"numDecimals,omitempty"`
	OnlineResource       string `json:"onlineResource,omitempty"`
	Verbose              bool   `json:"verbose,omitempty"`
	VerboseExceptions    bool   `json:"verboseExceptions,omitempty"`

	// Proxy base URL
	ProxyBaseURL         string `json:"proxyBaseUrl,omitempty"`
	UseHeadersProxyURL   bool   `json:"useHeadersProxyURL,omitempty"`

	// Logging
	LoggingLevel         string `json:"loggingLevel,omitempty"`
	LoggingLocation      string `json:"loggingLocation,omitempty"`
	StdOutLogging        bool   `json:"stdOutLogging,omitempty"`

	// Admin
	AdminUsername        string `json:"adminUsername,omitempty"`
	AdminPassword        string `json:"adminPassword,omitempty"`

	// Contact information
	Contact              *GeoServerContact `json:"contact,omitempty"`
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

// Icon returns an appropriate Nerd Font icon for the file type
// See: https://www.nerdfonts.com/cheat-sheet
func (f FileType) Icon() string {
	switch f {
	case FileTypeDirectory:
		return "\uf07b" // fa-folder
	case FileTypeShapefile:
		return "\uf279" // fa-map
	case FileTypeGeoPackage:
		return "\uf187" // fa-archive
	case FileTypeGeoTIFF:
		return "\uf03e" // fa-image
	case FileTypeGeoJSON:
		return "\uf121" // fa-code
	case FileTypeSLD:
		return "\uf53f" // fa-palette
	case FileTypeCSS:
		return "\uf53f" // fa-palette
	case FileTypeGpkgLayer:
		return "\uf5fd" // fa-layer-group
	default:
		return "\uf15b" // fa-file
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
	Name       string
	Path       string
	Type       FileType
	Size       int64
	IsDir      bool
	Selected   bool
	Expanded   bool        // Whether the item is expanded (for GeoPackages)
	Children   []LocalFile // Child items (layers inside GeoPackages)
	ParentPath string      // Parent GeoPackage path (for layers inside GeoPackages)
	LayerName  string      // Layer name inside GeoPackage
}

// CanExpand returns true if this file type can be expanded to show children
func (f *LocalFile) CanExpand() bool {
	return f.Type == FileTypeGeoPackage
}

// FileTypeGpkgLayer represents a layer inside a GeoPackage
const FileTypeGpkgLayer FileType = 100

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
