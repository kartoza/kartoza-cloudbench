# Kartoza GeoServer Client - Technical Specification

This document provides a detailed specification of all features, behaviors, and requirements of the Kartoza GeoServer Client application. It serves as both a reference for developers and a functional specification for testing.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [User Interface](#user-interface)
4. [Connection Management](#connection-management)
5. [File Browser](#file-browser)
6. [GeoServer Tree](#geoserver-tree)
7. [CRUD Operations](#crud-operations)
8. [File Upload](#file-upload)
9. [Layer Preview](#layer-preview)
10. [Keyboard Shortcuts](#keyboard-shortcuts)
11. [Configuration](#configuration)
12. [API Integration](#api-integration)

---

## Overview

The Kartoza GeoServer Client is a Terminal User Interface (TUI) application for managing GeoServer instances. It provides a Midnight Commander-style dual-panel interface with:

- **Left Panel**: Local filesystem browser for geospatial files
- **Right Panel**: GeoServer resource tree for multiple connections

### Key Capabilities

- Browse and select local geospatial files (Shapefile, GeoPackage, GeoTIFF, GeoJSON, SLD, CSS)
- Manage multiple GeoServer connections simultaneously
- Navigate GeoServer hierarchy (workspaces, stores, layers, styles)
- Upload files to GeoServer with progress tracking and verification
- Create, edit, and delete GeoServer resources
- Preview layers in a browser-based map viewer

---

## Architecture

### Technology Stack

- **Language**: Go 1.23+
- **TUI Framework**: Bubble Tea (Elm-style architecture)
- **Styling**: Lip Gloss
- **Animations**: Harmonica (spring physics)
- **Map Preview**: MapLibre GL JS with OpenLayers fallback

### Package Structure

```
internal/
├── api/           # GeoServer REST API client
├── config/        # Configuration management
├── models/        # Data models (TreeNode, LocalFile, etc.)
├── preview/       # Browser-based layer preview server
├── tui/           # Terminal UI components
│   ├── app.go          # Main application state and Update loop
│   ├── app_tree.go     # Tree building and navigation
│   ├── app_upload.go   # File upload and verification
│   ├── app_crud.go     # CRUD operations
│   ├── components/     # Reusable UI components
│   ├── screens/        # Full-screen views (connections)
│   └── styles/         # Style definitions
└── verify/        # Upload verification (WFS-based)
```

### Application State

The application maintains:
- `clients`: Map of connection ID to API client (`map[string]*api.Client`)
- `config`: Application configuration with connections list
- `treeView`: GeoServer resource tree component
- `fileBrowser`: Local file browser component
- `focusLeft`: Boolean indicating which panel has focus

---

## User Interface

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Kartoza GeoServer Client                                      ┊ Tab │
├─────────────────────────────────┬───────────────────────────────────┤
│ Local Files                     │ GeoServer Resources               │
│ ─────────────────────────────── │ ─────────────────────────────────  │
│ 📁 ..                           │ 🌐 Production Server              │
│ 📁 data/                        │   └── 📦 cite                     │
│ 🗺️ countries.shp               │       ├── 📊 postgis_db           │
│ 🛰️ elevation.tif               │       │   └── 🗺️ countries        │
│ ✓ 📦 parks.gpkg                 │       └── 🖼️ dem_store            │
│ 🎨 style.sld                    │ 🌐 Development Server             │
│                                 │   └── 📦 test                     │
│                                 │                                   │
├─────────────────────────────────┴───────────────────────────────────┤
│ Press ? for help │ 2 connections │ 1 file selected                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Focus Management

- `Tab`: Toggles focus between left (file browser) and right (GeoServer tree) panels
- Focused panel shows highlighted selection
- Non-focused panel shows dimmed selection
- Some actions require specific panel focus (e.g., upload requires right panel focus for target)

### Visual Indicators

- **Icons**: Each resource type has a distinct icon
  - 🌐 Connection
  - 📦 Workspace
  - 📊 Data Store
  - 🖼️ Coverage Store
  - 🗺️ Layer
  - 🎨 Style
  - 📁 Folder
  - Various file type icons

- **Status Indicators**:
  - ✓ Checkmark for selected files
  - ⟳ Spinner for loading nodes
  - ⚠️ Warning for errors
  - ✅ Success indicators
  - ❌ Error indicators

### Dialogs

All dialogs use smooth spring-physics animations (Harmonica):

1. **Info Dialog**: Shows resource metadata with extended info loaded from REST API
2. **Confirm Dialog**: Yes/No confirmation for destructive actions
3. **Progress Dialog**: Multi-file operation progress with item list
4. **Form Dialogs**: Wizard-style forms for CRUD operations

---

## Connection Management

### Connection Storage

Connections are stored in the configuration file with:
- `id`: Unique UUID identifier
- `name`: User-friendly display name
- `url`: GeoServer base URL (e.g., `https://geoserver.example.com/geoserver`)
- `username`: Authentication username
- `password`: Authentication password (stored in plaintext - see Security)

### Connection Manager Screen

Press `c` to open the connection manager:

| Key | Action |
|-----|--------|
| `a` | Add new connection |
| `e` | Edit selected connection |
| `d` | Delete selected connection |
| `t` | Test connection |
| `Enter` | Connect to selected |
| `Esc` | Close manager |

### Multi-Connection Support

- All configured connections appear as root nodes in the GeoServer tree
- Each connection is independently expandable
- Operations target the connection of the currently selected node
- API clients are instantiated per-connection (`clients map[string]*api.Client`)

### Connection Info Dialog

Press `i` on a connection node to view:
- Connection name and URL
- Username
- **Server Status** (loaded from REST API):
  - GeoServer version
  - GeoTools version
  - GeoWebCache version
  - Build timestamp
  - Git revision

---

## File Browser

### Supported File Types

| Type | Extensions | Icon | Can Upload |
|------|------------|------|------------|
| Shapefile | `.shp`, `.zip` | 🗺️ | Yes |
| GeoPackage | `.gpkg` | 📦 | Yes |
| GeoTIFF | `.tif`, `.tiff` | 🛰️ | Yes |
| GeoJSON | `.geojson`, `.json` | 📋 | No (planned) |
| SLD Style | `.sld` | 🎨 | Yes |
| CSS Style | `.css` | 🎨 | Yes |
| Directory | - | 📁 | No |
| Other | - | 📄 | No |

### Navigation

| Key | Action |
|-----|--------|
| `↑`/`k` | Move selection up |
| `↓`/`j` | Move selection down |
| `Enter`/`l` | Open directory or select file |
| `Backspace`/`h` | Go to parent directory |
| `PgUp`/`PgDn` | Page up/down |
| `Home`/`End` | Go to first/last item |

### File Selection

- `Space`: Toggle file selection
- Selected files show checkmark (✓) prefix
- Multiple files can be selected for batch upload
- Selection persists when navigating directories (within same parent)

### File Info

Press `i` on a file to view:
- File name and path
- File type
- File size (human-readable: KB, MB, GB)
- Uploadable status

---

## GeoServer Tree

### Node Types

```go
const (
    NodeTypeConnection    // Root level - represents a GeoServer instance
    NodeTypeWorkspace     // GeoServer workspace
    NodeTypeDataStore     // Vector data store
    NodeTypeCoverageStore // Raster coverage store
    NodeTypeLayer         // Published layer
    NodeTypeLayerGroup    // Layer group
    NodeTypeStyle         // Style definition
    NodeTypeWMSStore      // Cascading WMS store
)
```

### Tree Structure

```
🌐 Connection Name
└── 📦 Workspace
    ├── 📊 Data Store
    │   └── 🗺️ Layer
    ├── 🖼️ Coverage Store
    │   └── 🛰️ Coverage
    ├── 🎨 Styles
    └── 📚 Layer Groups
```

### Lazy Loading

- Nodes are loaded on-demand when expanded
- Loading indicator (⟳) shown during fetch
- Errors are displayed inline on failed nodes
- Refresh (`r`) reloads the current node's children

### Tree State Preservation

- Tree expansion state is preserved across operations
- After CRUD operations, the tree is refreshed but expansion state is restored
- Node selection is maintained when possible

### Node Navigation

| Key | Action |
|-----|--------|
| `↑`/`k` | Move to previous visible node |
| `↓`/`j` | Move to next visible node |
| `Enter`/`l` | Expand node / Load children |
| `Backspace`/`h` | Collapse node |
| `r` | Refresh current node |

---

## CRUD Operations

### Create Operations

Press `n` to create new resources:

#### Workspace Creation
- Name input with validation
- Default workspace toggle
- Isolated workspace toggle
- OGC services toggles (WMS, WFS, WCS, WPS, WMTS)

#### Data Store Creation
Wizard with type selection:
1. **PostGIS**: Host, port, database, schema, user, password
2. **Shapefile Directory**: Path to directory
3. **GeoPackage**: Path to file
4. **WFS**: Remote WFS URL

#### Coverage Store Creation
Wizard with type selection:
1. **GeoTIFF**: Path to file
2. **World Image**: Path with world file
3. **Image Mosaic**: Path to mosaic directory
4. **Image Pyramid**: Path to pyramid
5. **ArcGrid**: Path to .asc file
6. **GeoPackage (Raster)**: Path to file

### Edit Operations

Press `e` to edit resources:

#### Workspace Edit
- Rename workspace
- Toggle default/isolated settings
- Enable/disable OGC services

#### Layer Edit
- Toggle enabled state
- Toggle advertised state
- Toggle queryable state (vector only)

#### Store Edit
- Rename store
- Toggle enabled state
- Edit description

#### Style Edit (TUI)
- Edit style name (create mode only)
- Select style format (SLD or CSS)
- Edit style content in text area
- Keyboard shortcuts: `Enter` to edit field, `Ctrl+S` to save, `Tab` to navigate fields

#### Style Edit (Web UI)
- Visual Editor: Graphical rule editing with color pickers and sliders
  - Geometry type selection (Polygon, Line, Point)
  - Fill color and opacity controls
  - Stroke color, width, and opacity controls
  - Point symbol shape and size (for point styles)
  - Visual preview swatch
  - Multiple rules with Add/Delete functionality
- Code Editor: CodeMirror-based SLD/CSS editing with syntax highlighting
- Format switching between SLD and CSS
- Quick Actions for common style templates (Polygon, Line, Point)
- Real-time validation of XML/CSS content

### Delete Operations

Press `d` to delete resources:
- Confirmation dialog with resource name
- Recursive delete for workspaces (with warning)
- Cascade behavior follows GeoServer defaults

---

## File Upload

### Upload Flow

1. **Select Files**: Use file browser to select files with `Space`
2. **Select Target**: Navigate to target workspace in GeoServer tree
3. **Initiate Upload**: Press `u` to start upload
4. **Confirmation**: Review files and destination
5. **Progress**: Watch progress dialog with file list
6. **Verification**: Automatic verification for supported types
7. **Result**: Success/failure notification

### Upload Targets

| File Type | Target Store Type | Layer Type |
|-----------|-------------------|------------|
| Shapefile | Data Store | Vector |
| GeoPackage | Data Store | Vector |
| GeoTIFF | Coverage Store | Raster |
| SLD/CSS | Styles | Style |

### Progress Dialog

During upload:
- Shows total file count and current index
- Lists all files with status indicators
- Current file highlighted
- Error messages displayed if upload fails

### Verification

After successful upload (vector layers only):
- Connects to layer via WFS
- Compares feature count with local file
- Displays verification result in progress dialog

---

## Layer Preview

### Activation

Press `o` on a layer, layer group, or store to open preview:
- Status message shown: "Opening preview for [name] in browser..."
- Local HTTP server starts (if not already running)
- Browser opens to preview page

### Preview Features

#### MapLibre GL View
- Hardware-accelerated WebGL rendering
- OpenStreetMap base map
- WMS tile layer overlay from GeoServer
- Auto-zoom to layer extent

#### Layer Controls
- Opacity slider
- Layer toggle
- Zoom to extent button

#### Feature Query (Vector Layers)
- Click on map to query features
- Popup shows feature attributes
- Formatted attribute display

#### Metadata Panel
- Layer name and workspace
- Store information
- Service endpoints (WMS, WFS)
- Bounding box

#### Attributes Table
- Paginated feature attribute table
- Column headers from schema
- Scrollable content

### Server Management

- Single preview server instance shared across previews
- Server automatically starts when needed
- Server runs on available port (default: 8080)
- Updates layer when new preview requested

---

## Keyboard Shortcuts

### Global

| Key | Action |
|-----|--------|
| `Tab` | Switch panel focus |
| `?` / `F1` | Toggle help overlay |
| `q` / `Ctrl+C` | Quit application |
| `Esc` | Close dialog / Cancel operation |

### Panel-Specific

| Key | Panel | Action |
|-----|-------|--------|
| `c` | Any | Open connection manager |
| `u` | Right | Upload selected files |
| `i` | Any | View resource info |
| `r` | Right | Refresh tree node |
| `n` | Right | Create new resource |
| `e` | Right | Edit selected resource |
| `d` | Right | Delete selected resource |
| `o` | Right | Open layer preview |

### Navigation

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` / `l` | Open / Expand / Select |
| `Backspace` / `h` | Back / Collapse |
| `PgUp` | Page up |
| `PgDn` | Page down |
| `Home` | Go to first item |
| `End` | Go to last item |

### Form Editing

| Key | Action |
|-----|--------|
| `j` / `↓` | Next field |
| `k` / `↑` | Previous field |
| `Enter` | Edit field / Toggle boolean |
| `Tab` | Next section (wizards) |
| `Shift+Tab` | Previous section (wizards) |
| `Ctrl+S` | Save and submit |
| `Esc` | Cancel and close |

---

## Configuration

### File Location

Configuration is stored at:
```
~/.config/kartoza-geoserver-client/config.json
```

### Schema

```json
{
  "connections": [
    {
      "id": "uuid-string",
      "name": "Display Name",
      "url": "https://geoserver.example.com/geoserver",
      "username": "admin",
      "password": "password"
    }
  ],
  "active_connection": "uuid-string",
  "last_local_path": "/path/to/last/directory"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `connections` | Array | List of saved GeoServer connections |
| `connections[].id` | String | Unique identifier (UUID v4) |
| `connections[].name` | String | User-friendly display name |
| `connections[].url` | String | GeoServer base URL |
| `connections[].username` | String | HTTP Basic auth username |
| `connections[].password` | String | HTTP Basic auth password |
| `active_connection` | String | ID of last active connection |
| `last_local_path` | String | Last browsed local directory |

### Security Considerations

- Passwords are stored in plaintext
- Configuration file should have restricted permissions (600)
- Future: Consider keyring integration for password storage

---

## API Integration

### REST API Endpoints Used

#### System
- `GET /rest/about/version` - Server information

#### Workspaces
- `GET /rest/workspaces` - List workspaces
- `POST /rest/workspaces` - Create workspace
- `PUT /rest/workspaces/{name}` - Update workspace
- `DELETE /rest/workspaces/{name}` - Delete workspace

#### Data Stores
- `GET /rest/workspaces/{ws}/datastores` - List data stores
- `POST /rest/workspaces/{ws}/datastores` - Create data store
- `PUT /rest/workspaces/{ws}/datastores/{name}` - Update data store
- `DELETE /rest/workspaces/{ws}/datastores/{name}` - Delete data store

#### Coverage Stores
- `GET /rest/workspaces/{ws}/coveragestores` - List coverage stores
- `POST /rest/workspaces/{ws}/coveragestores` - Create coverage store
- `PUT /rest/workspaces/{ws}/coveragestores/{name}` - Update coverage store
- `DELETE /rest/workspaces/{ws}/coveragestores/{name}` - Delete coverage store

#### Layers
- `GET /rest/layers/{ws}:{layer}` - Get layer info
- `PUT /rest/layers/{ws}:{layer}` - Update layer
- `GET /rest/workspaces/{ws}/datastores/{store}/featuretypes` - List feature types
- `GET /rest/workspaces/{ws}/coveragestores/{store}/coverages` - List coverages

#### Styles
- `GET /rest/workspaces/{ws}/styles` - List styles
- `POST /rest/workspaces/{ws}/styles` - Upload style
- `PUT /rest/workspaces/{ws}/styles/{name}` - Update style

#### File Upload
- `PUT /rest/workspaces/{ws}/datastores/{name}/file.shp` - Upload shapefile
- `PUT /rest/workspaces/{ws}/datastores/{name}/file.gpkg` - Upload GeoPackage
- `PUT /rest/workspaces/{ws}/coveragestores/{name}/file.geotiff` - Upload GeoTIFF

### WFS Integration

Used for upload verification:
- `GET /{ws}/wfs?request=GetCapabilities` - Check layer exists
- `GET /{ws}/wfs?request=GetFeature&typeName={layer}&count=0` - Get feature count

### WMS Integration

Used for layer preview:
- `GET /{ws}/wms?request=GetCapabilities` - Get layer info
- `GET /{ws}/wms?request=GetMap&...` - Render map tiles
- `GET /{ws}/wms?request=GetFeatureInfo&...` - Query features

---

## Error Handling

### User Feedback

- **Error messages**: Displayed in status bar with red styling
- **Success messages**: Displayed in status bar with green styling
- **Loading states**: Spinner icons and "Loading..." text

### Recovery

- Failed operations show error in dialog
- User can retry or cancel
- Tree state preserved on errors
- Connection failures don't crash application

### Logging

- Errors logged to stderr
- Debug logging available via environment variable (planned)

---

## Future Enhancements

### Planned Features

1. **GeoJSON Upload**: Support for uploading GeoJSON files
2. ~~**Style Editor**: In-TUI style editing with preview~~ (Implemented in v0.5.0)
3. **Bulk Operations**: Multi-select for tree operations
4. **Search/Filter**: Filter files and tree nodes
5. **Keyring Integration**: Secure password storage
6. **REST API Cache**: Reduce API calls with caching
7. **Offline Mode**: Cached tree browsing when disconnected
8. **Raster Verification**: WCS-based verification for coverage uploads

### Known Limitations

1. GeoTIFF verification not supported (requires WCS integration)
2. Large file uploads may timeout (30-second default)
3. No support for cascading WMS stores (read-only)
4. Password stored in plaintext in config file

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2024 | Initial release with basic browsing and upload |
| 0.2.0 | 2024 | Added CRUD operations and wizard forms |
| 0.3.0 | 2024 | Multi-connection support, layer preview |
| 0.4.0 | 2025 | Server info dialog, code reorganization |
| 0.5.0 | 2025 | Style Editor with visual/code editing (TUI + Web UI) |

---

*This specification is maintained alongside the codebase and should be updated as features are added or modified.*
