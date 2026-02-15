# Kartoza CloudBench - Technical Specification

This document provides a detailed specification of all features, behaviors, and requirements of the Kartoza CloudBench application. It serves as both a reference for developers and a functional specification for testing.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [User Interface](#user-interface)
4. [Connection Management](#connection-management)
5. [File Browser](#file-browser)
6. [Unified Resource Tree](#unified-resource-tree)
7. [CRUD Operations](#crud-operations)
8. [File Upload](#file-upload)
9. [Layer Preview](#layer-preview)
10. [Keyboard Shortcuts](#keyboard-shortcuts)
11. [Configuration](#configuration)
12. [API Integration](#api-integration)

---

## Overview

Kartoza CloudBench is a unified platform for GeoServer and PostgreSQL management with AI query capabilities. It provides both a Terminal User Interface (TUI) and Web UI with:

- **Left Panel**: Local filesystem browser for geospatial files
- **Right Panel**: Unified resource tree for GeoServer and PostgreSQL

### Key Capabilities

- Browse and select local geospatial files (Shapefile, GeoPackage, GeoTIFF, GeoJSON, SLD, CSS)
- Manage multiple GeoServer connections simultaneously
- Navigate GeoServer hierarchy (workspaces, stores, layers, styles)
- Upload files to GeoServer with progress tracking and verification
- Create, edit, and delete GeoServer resources
- Preview layers in a browser-based map viewer
- **PostgreSQL Integration** (Planned): Manage PostgreSQL services via pg_service.conf
- **AI Query Engine** (Planned): Natural language to SQL query generation
- **Visual Query Designer** (Planned): Metabase-style visual query builder

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
├── postgres/      # PostgreSQL integration (Phase 2)
│   ├── service.go     # pg_service.conf parsing
│   ├── client.go      # Database operations
│   └── schema.go      # Schema harvesting
├── llm/           # LLM integration (Phase 5)
│   ├── engine.go      # Query generation
│   ├── embedded.go    # llama.cpp wrapper
│   └── ollama.go      # Ollama client
├── nn/            # Neural network (Phase 5)
│   ├── model.go       # Seq2Seq model
│   ├── trainer.go     # Training logic
│   └── tokenizer.go   # SQL tokenizer
├── ogr2ogr/       # Data import (Phase 3)
│   └── import.go      # ogr2ogr wrapper
├── integration/   # Cross-system operations (Phase 4, 7)
│   ├── postgis_store.go    # PG → GeoServer stores
│   └── sql_view_layer.go   # Query → SQL View layers
├── tui/           # Terminal UI components
│   ├── app.go          # Main application state and Update loop
│   ├── app_tree.go     # Tree building and navigation
│   ├── app_upload.go   # File upload and verification
│   ├── app_crud.go     # CRUD operations
│   ├── components/     # Reusable UI components
│   ├── screens/        # Full-screen views (connections)
│   └── styles/         # Style definitions
├── webserver/     # HTTP handlers for Web UI
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
│ Kartoza CloudBench                                            ┊ Tab │
├─────────────────────────────────┬───────────────────────────────────┤
│ Local Files                     │ Resources                         │
│ ─────────────────────────────── │ ─────────────────────────────────  │
│ 📁 ..                           │ ☁️ Kartoza CloudBench              │
│ 📁 data/                        │   ├── 🌐 GeoServer                 │
│ 🗺️ countries.shp               │   │   └── 🖥️ Production Server     │
│ 🛰️ elevation.tif               │   │       └── 📦 cite              │
│ ✓ 📦 parks.gpkg                 │   │           ├── 📊 postgis_db    │
│ 🎨 style.sld                    │   │           └── 🖼️ dem_store     │
│                                 │   └── 🐘 PostgreSQL                │
│                                 │       └── 🔌 local_db              │
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

## Unified Resource Tree

### Node Types

```go
const (
    NodeTypeCloudBenchRoot  // Application root: "Kartoza CloudBench"
    NodeTypeGeoServerRoot   // "GeoServer" container
    NodeTypePostgreSQLRoot  // "PostgreSQL" container
    NodeTypeConnection      // GeoServer connection
    NodeTypePGService       // pg_service.conf entry
    NodeTypePGSchema        // PostgreSQL schema
    NodeTypePGTable         // Database table
    NodeTypePGView          // Database view
    NodeTypePGColumn        // Table column
    NodeTypeWorkspace       // GeoServer workspace
    NodeTypeDataStore       // Vector data store
    NodeTypeCoverageStore   // Raster coverage store
    NodeTypeLayer           // Published layer
    NodeTypeLayerGroup      // Layer group
    NodeTypeStyle           // Style definition
    NodeTypeWMSStore        // Cascading WMS store
)
```

### Tree Structure

```
☁️ Kartoza CloudBench
├── 🌐 GeoServer
│   └── 🖥️ Connection Name
│       └── 📦 Workspace
│           ├── 📊 Data Store
│           │   └── 🗺️ Layer
│           ├── 🖼️ Coverage Store
│           │   └── 🛰️ Coverage
│           ├── 🎨 Styles
│           └── 📚 Layer Groups
└── 🐘 PostgreSQL
    └── 🔌 Service Entry (from pg_service.conf)
        └── 📁 Schema
            ├── 📋 Table
            │   └── 🏷️ Column
            └── 👁️ View
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

#### Style Creation
Press `n` on Styles folder to create a new style. A selection dialog offers two options:

**Visual Editor (WYSIWYG)**:
- Creates styles using a visual interface
- Requires at least one layer in the workspace for preview
- Default style name: "NewStyle" (editable)
- Real-time preview while designing
- Generates SLD format on save

**Code Editor (SLD/CSS)**:
- Creates styles using text-based SLD or CSS input
- Style name and format selection
- Syntax-aware editing

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

**Text-based Editor** (press `e` on a style):
- Edit style name (create mode only)
- Select style format (SLD or CSS)
- Edit style content in text area
- Keyboard shortcuts: `Enter` to edit field, `Ctrl+S` to save, `Tab` to navigate fields

**WYSIWYG Visual Editor** (press `v` on a style):
- Split-view layout: properties panel on left, live preview on right
- Geometry-aware symbolizers:
  - **Point**: shape (circle, square, triangle, star, cross, etc.), size, fill color/opacity, stroke color/width, rotation
  - **Line**: stroke color/width/opacity, dash patterns (solid, dash, dot, dash-dot), line cap/join styles
  - **Polygon**: fill color/opacity/pattern, stroke color/width/opacity
  - **Text**: font family/size/weight/style, color, halo settings, label placement
- Rule management: add/delete/reorder rules, rule names and titles
- Real-time WMS preview using SLD_BODY parameter
- Keyboard shortcuts: `↑↓/jk` navigate, `←→/hl` adjust values, `Enter` edit field, `Ctrl+S` save, `Ctrl+P` refresh preview, `Ctrl+A` add rule, `Esc` cancel
- Color picker with presets, RGB sliders, and hex input modes

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

### TUI Preview (Terminal)

Press `o` on a layer, layer group, or store to open inline preview:

#### Image Rendering Protocols
Automatically detects and uses the best available protocol:
1. **Kitty Graphics Protocol** - Native image support in Kitty terminal
2. **Sixel** - Uses img2sixel if available for wide terminal support
3. **Chafa** - Unicode block art for color terminals
4. **ASCII Art** - Fallback grayscale rendering for any terminal

#### Map Controls (Side Panel)
- **Zoom**: `+`/`-` keys to zoom in/out
- **Pan**: Arrow keys or `h`/`j`/`k`/`l` to pan
- **Style**: `s`/`S` to cycle through available styles
- **Refresh**: `r` to reload the map
- **Close**: `Esc` or `q` to close preview

#### Display Features
- WMS GetMap requests to GeoServer
- Automatic authentication with saved credentials
- Current zoom level display
- Bounding box coordinates
- Style selector showing all available layer styles
- Status bar with loading indicator

### Web UI Preview (Browser)

MapLibre GL JS-based interactive map viewer:

#### MapLibre GL View
- Hardware-accelerated WebGL rendering
- OpenStreetMap base map
- WMS tile layer overlay from GeoServer
- Auto-zoom to layer extent

#### View Modes
- **2D Mode**: Flat map view with pitch locked to 0
- **3D Mode**: 45-degree pitch with rotation enabled
- **Globe Mode**: Full 3D globe view at zoom level 1

#### Style Picker
- Dropdown menu showing all available layer styles
- Default style highlighted with badge
- Style changes update WMS tiles automatically
- Map refreshes when style is changed

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

## Universal Search

The application provides a universal search feature that allows quick navigation to any resource across all connected GeoServer instances.

### Activation

- **TUI**: Press `Ctrl+K` or `/` from any screen
- **Web UI**: Press `Ctrl+K` (or `Cmd+K` on macOS) or click the search bar in the header

### Search Behavior

- Searches across all active GeoServer connections
- Minimum 2 characters required to trigger search
- Real-time results as you type
- Fuzzy matching on resource names

### Searchable Resources

| Resource Type | Icon | Badge Color |
|--------------|------|-------------|
| Workspace | 📁 | Blue |
| Data Store | 💾 | Green |
| Coverage Store | 🖼️ | Orange |
| Layer | 🗺️ | Teal |
| Style | 🎨 | Purple |
| Layer Group | 📚 | Cyan |

### Result Display

Each search result shows:
- **Icon**: Monochrome Nerd Font icon representing resource type
- **Name**: Resource name (highlighted matching text)
- **Tags**: Resource type and additional metadata (e.g., format, "Global")
- **Location**: Server name • Workspace path

### Navigation

- **TUI**:
  - `↑`/`↓` or `Ctrl+P`/`Ctrl+N`: Navigate results
  - `Enter`: Select and navigate to resource
  - `PgUp`/`PgDn`: Page through results
  - `Esc`: Close search modal

- **Web UI**:
  - `↑`/`↓`: Navigate results
  - `Enter`: Select and navigate to resource
  - `Esc`: Close search modal

### Result Selection

When a result is selected:
1. The search modal closes
2. The tree view navigates to the selected resource
3. Parent nodes are automatically expanded
4. The selected resource is highlighted

---

## Keyboard Shortcuts

### Global

| Key | Action |
|-----|--------|
| `Ctrl+K` / `/` | Open universal search modal |
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

## Terria Integration

The application integrates with TerriaJS, a powerful open-source framework for web-based 2D/3D geospatial visualization. This enables viewing GeoServer data in a 3D globe interface.

### Features

- **Embedded 3D Viewer**: Built-in Cesium-based 3D globe viewer at `/viewer/` - no external dependencies
- **Terria Catalog Export**: Export workspaces, layers, and layer groups as TerriaJS-compatible catalog JSON
- **3D Globe Viewer**: Open layers directly in the embedded viewer or any external Terria-based viewer
- **Layer Group Stories**: Export layer groups as Terria "stories" with individual controllable layers
- **CORS Proxy**: Built-in proxy for cross-origin data access
- **View Modes**: Toggle between 3D Globe, 2D Map, and Columbus View
- **Layer Controls**: Toggle visibility and adjust opacity for each layer

### TUI Usage

Press `T` (Shift+T) on supported nodes:
- **Connection**: Export entire GeoServer as catalog
- **Workspace**: Export workspace layers as catalog group
- **Layer**: Open layer in Terria 3D viewer
- **Layer Group**: Export as story with individual layers

### Web UI Usage

Click the globe icon (🌍) next to layers and layer groups to open in Terria.

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /viewer/` | Embedded Cesium-based 3D viewer |
| `GET /api/terria/connection/{connId}` | Export entire connection catalog |
| `GET /api/terria/workspace/{connId}/{ws}` | Export workspace catalog |
| `GET /api/terria/layer/{connId}/{ws}/{layer}` | Export layer as WMS item |
| `GET /api/terria/layergroup/{connId}/{ws}/{group}` | Export layer group |
| `GET /api/terria/story/{connId}/{ws}/{group}` | Export layer group as story |
| `GET /api/terria/init/{connId}.json` | Generate Terria init file |
| `GET /api/terria/proxy?url={url}` | CORS proxy for data access |
| `GET /api/terria/download/{connId}` | Download catalog as JSON file |

### Embedded 3D Viewer

Access the built-in 3D viewer at `/viewer/` with a catalog URL hash:
```
http://localhost:8080/viewer/#http://localhost:8080/api/terria/layer/CONN_ID/WORKSPACE/LAYER
```

### Using with External Terria

Optionally load catalogs into any TerriaMap instance (e.g., map.terria.io) via URL fragment:
```
https://map.terria.io/#http://localhost:8080/api/terria/init/CONNECTION_ID.json
```

---

## Future Enhancements

### Planned Features

1. **GeoJSON Upload**: Support for uploading GeoJSON files
2. ~~**Style Editor**: In-TUI style editing with preview~~ (Implemented in v0.5.0)
3. **Bulk Operations**: Multi-select for tree operations
4. ~~**Search/Filter**: Filter files and tree nodes~~ (Implemented - Universal Search)
5. **Keyring Integration**: Secure password storage
6. **REST API Cache**: Reduce API calls with caching
7. **Offline Mode**: Cached tree browsing when disconnected
8. **Raster Verification**: WCS-based verification for coverage uploads
9. ~~**Terria Integration**: 3D globe viewer support~~ (Implemented in v0.7.0)
10. **Embedded TerriaMap**: Self-hosted Terria viewer (setup script available)

### Known Limitations

1. GeoTIFF verification not supported (requires WCS integration)
2. Large file uploads may timeout (30-second default)
3. No support for cascading WMS stores (read-only)
4. Password stored in plaintext in config file
5. Terria integration requires external viewer (NationalMap) unless TerriaMapStatic is installed

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2024 | Initial release with basic browsing and upload |
| 0.2.0 | 2024 | Added CRUD operations and wizard forms |
| 0.3.0 | 2024 | Multi-connection support, layer preview |
| 0.4.0 | 2025 | Server info dialog, code reorganization |
| 0.5.0 | 2025 | Style Editor with visual/code editing (TUI + Web UI) |
| 0.6.0 | 2025 | MapLibre GL viewer (Web), TUI map preview with Kitty/Sixel/Chafa support |
| 0.7.0 | 2025 | Terria 3D globe integration, catalog export, CORS proxy |

---

*This specification is maintained alongside the codebase and should be updated as features are added or modified.*
