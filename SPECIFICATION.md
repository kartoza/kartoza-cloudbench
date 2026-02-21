# Kartoza CloudBench - Technical Specification

This document provides a detailed specification of all features, behaviors, and requirements of the Kartoza CloudBench application. It serves as both a reference for developers and a functional specification for testing.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Branding Guidelines](#branding-guidelines)
4. [User Interface](#user-interface)
5. [Connection Management](#connection-management)
6. [File Browser](#file-browser)
7. [Unified Resource Tree](#unified-resource-tree)
8. [CRUD Operations](#crud-operations)
9. [File Upload](#file-upload)
10. [Layer Preview](#layer-preview)
11. [Universal Search](#universal-search)
12. [Keyboard Shortcuts](#keyboard-shortcuts)
13. [Configuration](#configuration)
14. [API Integration](#api-integration)
15. [PostgreSQL Integration](#postgresql-integration)
16. [Data Import (ogr2ogr)](#data-import-ogr2ogr)
17. [PostgreSQL to GeoServer Bridge](#postgresql-to-geoserver-bridge)
18. [AI Query Engine](#ai-query-engine)
19. [Visual Query Designer](#visual-query-designer)
20. [SQL View Layers](#sql-view-layers)
21. [SQL Editor](#sql-editor)
22. [UI Animation System](#ui-animation-system)
23. [GeoWebCache (Tile Caching)](#geowebcache-tile-caching)
24. [Server Synchronization](#server-synchronization)
25. [Layer Metadata Management](#layer-metadata-management)
26. [Layer Groups](#layer-groups)
27. [Dashboard & Monitoring](#dashboard--monitoring)
28. [Raster Data Import](#raster-data-import)
29. [PostgreSQL Table Data Viewer](#postgresql-table-data-viewer)
30. [Terria Integration](#terria-integration)
31. [S3 Storage Integration](#s3-storage-integration)
32. [Cloud-Native Format Conversion](#cloud-native-format-conversion)
33. [Future Enhancements](#future-enhancements)
34. [Version History](#version-history)

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
- Preview layers in browser-based 2D map viewer and 3D globe
- Manage GeoWebCache tile seeding and truncation
- Synchronize configurations between GeoServer instances
- **PostgreSQL Integration**: Manage PostgreSQL services via pg_service.conf
- **Data Import**: Import vector and raster data to PostgreSQL via ogr2ogr/raster2pgsql
- **PostgreSQL to GeoServer Bridge**: Create PostGIS stores from PostgreSQL services
- **AI Query Engine**: Natural language to SQL query generation using local LLM
- **Visual Query Designer**: Metabase-style visual query builder
- **SQL View Layers**: Publish SQL queries as GeoServer WMS/WFS layers
- **Table Data Viewer**: Browse PostgreSQL table data with infinite scroll
- **S3 Storage Integration**: Connect to S3-compatible storage (MinIO, AWS S3, Wasabi, etc.)
- **Cloud-Native Conversion**: Convert geospatial files to cloud-native formats (COG, COPC, GeoParquet)

---

## Architecture

### Technology Stack

- **Language**: Go 1.23+
- **TUI Framework**: Bubble Tea (Elm-style architecture)
- **TUI Styling**: Lip Gloss
- **TUI Animations**: Harmonica (spring physics)
- **Web UI Framework**: React with TypeScript
- **Web UI Components**: Chakra UI
- **Web UI Animations**: Framer Motion (spring physics)
- **Map Viewer**: MapLibre GL JS
- **3D Globe Viewer**: Cesium.js
- **SQL Editor**: CodeMirror 6

### Package Structure

```
internal/
├── api/           # GeoServer REST API client
├── config/        # Configuration management
├── gwc/           # GeoWebCache integration
├── integration/   # Cross-system operations
│   ├── bridge.go         # PostgreSQL → GeoServer bridge
│   └── sqlview.go        # SQL View layer publishing
├── llm/           # LLM integration
│   ├── engine.go         # Query generation
│   ├── executor.go       # Safe query execution
│   ├── ollama.go         # Ollama client
│   └── types.go          # Data types
├── models/        # Data models (TreeNode, LocalFile, etc.)
├── ogr2ogr/       # Data import via ogr2ogr/raster2pgsql
├── postgres/      # PostgreSQL integration
│   ├── service.go        # pg_service.conf parsing
│   ├── client.go         # Database operations
│   └── schema.go         # Schema harvesting
├── preview/       # Browser-based layer preview server
├── query/         # Visual query builder
├── s3client/      # S3-compatible storage client
├── cloudnative/   # Cloud-native format conversion (COG, COPC, GeoParquet)
├── storage/       # File storage management
├── sync/          # Server synchronization
├── terria/        # Terria catalog export
├── tui/           # Terminal UI components
│   ├── app.go            # Main application state
│   ├── components/       # Reusable UI components
│   ├── screens/          # Full-screen views
│   └── styles/           # Style definitions
├── verify/        # Upload verification (WFS-based)
└── webserver/     # HTTP handlers (60+ endpoints)
    ├── handlers_*.go     # API handlers by domain
    └── static/           # Built React frontend

web/
├── src/
│   ├── api/              # TypeScript API client
│   ├── components/       # React components
│   │   ├── dialogs/      # Modal dialogs
│   │   └── *.tsx         # Main components
│   ├── stores/           # Zustand state management
│   ├── types/            # TypeScript definitions
│   └── utils/            # Animation utilities
└── package.json          # npm dependencies
```

### Application State

The application maintains:
- `clients`: Map of connection ID to API client (`map[string]*api.Client`)
- `s3Clients`: Map of S3 connection ID to S3 client (`map[string]*s3client.Client`)
- `config`: Application configuration with connections list
- `treeView`: GeoServer resource tree component
- `fileBrowser`: Local file browser component
- `focusLeft`: Boolean indicating which panel has focus
- `conversionMgr`: Cloud-native format conversion job manager

---

## Branding Guidelines

The application follows Kartoza's official brand guidelines to maintain visual consistency with the Kartoza Hugo website (kartoza-website). The visual style uses organic rounded corners, multi-layered shadows, and smooth transitions.

### Application Name

- **Full Name**: Kartoza Cloudbench
- **Display**: "Kartoza Cloudbench" in the header with Kartoza logo
- **Page Title**: "Kartoza Cloudbench" in browser tab

### Primary Brand Colors (Matching Hugo Website)

| Color Name | Hex Code | RGB | Usage |
|------------|----------|-----|-------|
| Primary Dark | `#1B6B9B` | rgb(27, 107, 155) | Dark accents, hover states |
| Primary | `#3B9DD9` | rgb(59, 157, 217) | Primary brand color, buttons, links |
| Primary Light | `#5BB5E8` | rgb(91, 181, 232) | Light accents, backgrounds |
| Accent Gold | `#E8A331` | rgb(232, 163, 49) | Accent color, highlights, call-to-action buttons |
| Accent Dark | `#D4922A` | rgb(212, 146, 42) | Darker accent for hover states |
| Text Primary | `#1a2a3a` | rgb(26, 42, 58) | Main text color (dark navy) |
| Text Secondary | `#4D6370` | rgb(77, 99, 112) | Secondary/muted text |

### Color Palette Variations

Each primary color has a full shade range (50-900) for consistent UI design:

**Blue Scale (kartoza):**
- `kartoza.50`: `#e6f3f8` - Lightest, for backgrounds
- `kartoza.100`: `#c2e1ed`
- `kartoza.200`: `#9acee2`
- `kartoza.300`: `#5BB5E8` - Primary Light
- `kartoza.400`: `#4ba9dc`
- `kartoza.500`: `#3B9DD9` - Primary (medium teal blue)
- `kartoza.600`: `#2f8ac4`
- `kartoza.700`: `#1B6B9B` - Primary Dark
- `kartoza.800`: `#155681`
- `kartoza.900`: `#0f4166` - Darkest

**Gold Scale (accent):**
- `accent.50`: `#fef8eb` - Lightest
- `accent.100`: `#fcecc8`
- `accent.200`: `#f9dda2`
- `accent.300`: `#F0B84D` - Accent Light
- `accent.400`: `#E8A331` - Primary brand gold
- `accent.500`: `#E8A331` - Primary brand gold
- `accent.600`: `#D4922A` - Accent Dark
- `accent.700`: `#b87d23`
- `accent.800`: `#96651c`
- `accent.900`: `#664612` - Darkest

**Gray Scale:**
- `gray.50`: `#f7f9fb` - Light Background 1
- `gray.100`: `#e8ecf0` - Light Background 2
- `gray.200`: `#d4dce4`
- `gray.300`: `#b0bcc8`
- `gray.400`: `#8a9aaa`
- `gray.500`: `#9E9E9E` - Grey
- `gray.600`: `#4D6370` - Text Secondary
- `gray.700`: `#3d4f5f` - Grey Dark
- `gray.800`: `#2a3a4a`
- `gray.900`: `#1a2a3a` - Text Primary (Dark Navy)

### Logo Usage

- **Logo Files**: Located in project root
  - `KartozaLogoHorizontalCMYK.svg` - Horizontal layout
  - `KartozaLogoVerticalCMYK.svg` - Vertical layout
- **Web Assets**: Copy to `web/public/kartoza-logo.svg`
- **Header Display**: White filter applied on gradient background (`filter: brightness(0) invert(1)`)
- **Minimum Size**: 32px height in header

### Link to kartoza.com

- The Kartoza logo in the header is clickable and links to https://kartoza.com
- Opens in a new tab (`target="_blank"`)

### UI Component Styling

**Buttons:**
- Primary buttons use `kartoza.500` with `kartoza.700` hover
- Accent buttons use `accent.400` with `accent.600` hover
- Multi-layered shadow effects using brand blue rgba(27, 107, 155, ...)
- Border radius: 10px
- Subtle translateY(-1px) lift on hover

**Cards and Containers:**
- Border radius: 12px standard, 8px for small elements, 16px for large sections
- Shadow: `0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)`
- Hover shadow: `0 8px 28px rgba(27, 107, 155, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)`
- Hover transform: translateY(-3px)

**Header:**
- Background: Gradient `linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 50%, #5BB5E8 100%)`
- Shadow: `0 2px 12px rgba(27, 107, 155, 0.08)`
- Text: White
- Button hover: `whiteAlpha.200`
- Contains logo, application name, search bar, and action buttons

**Gradients:**
- Hero/Header: `linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 50%, #5BB5E8 100%)`
- Horizontal: `linear-gradient(90deg, #3B9DD9 0%, #1B6B9B 100%)`
- Accent Background: `linear-gradient(135deg, rgba(232, 163, 49, 0.15) 0%, rgba(212, 146, 42, 0.1) 100%)`

### Typography

- **Font Family**: Roboto, -apple-system, BlinkMacSystemFont, sans-serif
- **Headings**: Font weight 600, color kartoza.700 for brand variants
- **Body Text**: Font weight 400
- **Accent Text**: color accent.400, font weight 600

### Animation & Transitions

- **Standard transition**: `all 0.25s ease`
- **Card/Shadow transition**: `box-shadow 0.3s ease, transform 0.3s ease`
- **Hover lift**: `translateY(-1px)` for buttons, `translateY(-3px)` for cards

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
    NodeTypeS3Root          // "S3 Storage" container
    NodeTypeConnection      // GeoServer connection
    NodeTypePGService       // pg_service.conf entry
    NodeTypePGSchema        // PostgreSQL schema
    NodeTypePGTable         // Database table
    NodeTypePGView          // Database view
    NodeTypePGColumn        // Table column
    NodeTypeS3Connection    // S3-compatible storage connection
    NodeTypeS3Bucket        // S3 bucket
    NodeTypeS3Folder        // Virtual folder (prefix) in S3
    NodeTypeS3Object        // S3 object (file)
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
├── 🐘 PostgreSQL
│   └── 🔌 Service Entry (from pg_service.conf)
│       └── 📁 Schema
│           ├── 📋 Table
│           │   └── 🏷️ Column
│           └── 👁️ View
└── ☁️ S3 Storage
    └── 💾 S3 Connection (MinIO, AWS S3, etc.)
        └── 📦 Bucket
            ├── 📁 Folder (virtual prefix)
            └── 📄 Object (file)
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
  "s3_connections": [
    {
      "id": "uuid-string",
      "name": "MinIO Local",
      "endpoint": "localhost:9000",
      "access_key": "minioadmin",
      "secret_key": "minioadmin",
      "region": "",
      "use_ssl": false,
      "path_style": true,
      "is_active": true
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
| `s3_connections` | Array | List of saved S3 connections |
| `s3_connections[].id` | String | Unique identifier (UUID v4) |
| `s3_connections[].name` | String | User-friendly display name |
| `s3_connections[].endpoint` | String | S3 endpoint (e.g., localhost:9000) |
| `s3_connections[].access_key` | String | S3 access key ID |
| `s3_connections[].secret_key` | String | S3 secret access key |
| `s3_connections[].region` | String | AWS region (optional) |
| `s3_connections[].use_ssl` | Boolean | Use HTTPS connection |
| `s3_connections[].path_style` | Boolean | Use path-style addressing |
| `s3_connections[].is_active` | Boolean | Connection active status |
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

## PostgreSQL Integration

The application provides comprehensive PostgreSQL database management through the standard `pg_service.conf` file.

### pg_service.conf Support

PostgreSQL services are read from the standard `~/.pg_service.conf` file:

```ini
[mydb]
host=localhost
port=5432
dbname=gisdb
user=gis_user
password=secret
sslmode=prefer
```

### Features

- **Service Discovery**: Automatically parses pg_service.conf entries
- **Connection Testing**: Test connectivity to PostgreSQL services
- **Schema Harvesting**: Parse database schemas, tables, views, and columns
- **PostGIS Detection**: Identify spatial tables with geometry columns
- **Geometry Type Detection**: Detect point, line, polygon, and multi-geometries

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pg/services` | GET | List all PostgreSQL services |
| `/api/pg/services` | POST | Create new service entry |
| `/api/pg/services/{name}` | DELETE | Delete service entry |
| `/api/pg/services/{name}/test` | POST | Test connection |
| `/api/pg/services/{name}/parse` | POST | Harvest schema metadata |
| `/api/pg/services/{name}/schema` | GET | Get harvested schema |
| `/api/pg/services/{name}/schemas` | GET | Get schemas for SQL completion |
| `/api/pg/services/{name}/stats` | GET | Get server statistics |
| `/api/query/execute` | POST | Execute SQL query |

### Data Viewer Dialog

The Data Viewer allows browsing table data with the following features:

- **Paginated Results**: View table data with configurable page sizes (25, 50, 100, 250, 500 rows)
- **Column Headers**: Displays all column names
- **Row Numbering**: Shows row numbers for easy reference
- **NULL Handling**: Displays NULL values with visual distinction
- **JSON Support**: Renders JSON/JSONB fields with syntax highlighting
- **Pagination Controls**: Navigate through pages with prev/next buttons or jump to specific page
- **Total Row Count**: Shows total rows in the table
- **Query Timing**: Displays query execution time
- **CSV Export**: Export current page data to CSV file
- **Refresh**: Reload data from the database

### Tree Structure

The PostgreSQL tree displays:
- **Service Nodes**: Database connections from pg_service.conf
  - Shows host, port, and database name
  - Refresh icon to reload schema data
  - Upload icon to import data
- **Schema Nodes**: Database schemas
  - Refresh icon to reload tables
  - Upload icon to import data into schema
  - Table count badge
- **Table Nodes**: Tables and views
  - View Data icon to open Data Viewer dialog
  - Query icon to open SQL query editor
  - Column count badge
- **Column Nodes**: Table columns
  - Shows column name, type, and nullability

### Schema Cache

After parsing, schemas are cached with:
- Schema names
- Table names with geometry columns and types
- View definitions
- Column data types and nullability
- Primary key information

---

## Data Import (ogr2ogr)

The application provides a geospatial data import facility using GDAL's ogr2ogr.

### Supported Formats

| Extension | Format |
|-----------|--------|
| `.shp` | ESRI Shapefile |
| `.geojson`, `.json` | GeoJSON |
| `.gpkg` | GeoPackage |
| `.kml` | KML |
| `.kmz` | KMZ (compressed KML) |
| `.gml` | GML |
| `.csv` | CSV with geometry |
| `.tab`, `.mif` | MapInfo File |
| `.dxf` | DXF |
| `.gpx` | GPX |
| `.sqlite`, `.db` | SQLite |
| `.gdb` | FileGDB |

### Import Features

- **Layer Detection**: Detect available layers in multi-layer sources (e.g., all tables in a GeoPackage)
- **Multi-Layer Import**: Import all layers from GeoPackage files with Select All/Deselect All controls
- **Custom Table Names**: Edit target table names for each layer before import
- **SRID Auto-detection**: Automatically detect source coordinate system
- **Reprojection**: Optionally reproject to target SRID
- **Overwrite/Append**: Replace or append to existing tables
- **Progress Tracking**: Real-time import progress updates
- **Background Jobs**: Async import with job status tracking
- **Schema Selection**: Choose target schema for imported tables

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pg/ogr2ogr/status` | GET | Check ogr2ogr availability |
| `/api/pg/import` | POST | Start import job |
| `/api/pg/import/{jobId}` | GET | Get job status |
| `/api/pg/import/upload` | POST | Upload file for import |
| `/api/pg/detect-layers` | POST | Detect layers in file |

### Import Request

```json
{
  "source_file": "/tmp/data.gpkg",
  "target_service": "mydb",
  "target_schema": "public",
  "table_name": "imported_data",
  "srid": 4326,
  "target_srid": 3857,
  "overwrite": true,
  "append": false,
  "source_layer": "layer_name"
}
```

---

## PostgreSQL to GeoServer Bridge

The application enables seamless integration between PostgreSQL databases and GeoServer through PostGIS data stores.

### Features

- **PostGIS Store Creation**: Create GeoServer PostGIS stores from pg_service.conf entries
- **Table Publishing**: Automatically publish spatial tables as GeoServer layers
- **Connection Bridging**: Link PostgreSQL services to GeoServer workspaces
- **JDBC Configuration**: Proper SSL mode mapping and connection pooling

### Bridge Wizard (TUI)

Press `b` to launch the bridge wizard:

1. **Select PostgreSQL Service**: Choose from pg_service.conf entries
2. **Select GeoServer**: Choose target GeoServer connection
3. **Select Workspace**: Choose or create target workspace
4. **Enter Store Name**: Name for the PostGIS data store
5. **Select Schema**: Choose PostgreSQL schema (default: public)
6. **Select Tables**: Optionally select tables to auto-publish as layers
7. **Confirm**: Review configuration and create bridge

### Bridge Wizard (Web UI)

Click the "Create Bridge" button to open the wizard modal with the same workflow.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bridge` | POST | Create PostgreSQL to GeoServer bridge |
| `/api/bridge/tables` | GET | Get available tables for a service |

### Bridge Request

```json
{
  "pg_service_name": "mydb",
  "geoserver_connection_id": "conn_1",
  "workspace": "cite",
  "store_name": "mydb_store",
  "schema": "public",
  "tables": ["countries", "cities"],
  "publish_layers": true
}
```

### PostGIS Store Parameters

The bridge creates PostGIS stores with optimized defaults:

| Parameter | Default |
|-----------|---------|
| Min Connections | 1 |
| Max Connections | 10 |
| Connection Timeout | 20s |
| Validate Connections | true |
| Fetch Size | 1000 |
| Expose Primary Keys | true |
| Loose BBox | true |
| Prepared Statements | true |

---

## AI Query Engine

The application includes an AI-powered natural language to SQL query engine using local LLM providers.

### Features

- **Natural Language Queries**: Ask questions in plain English
- **SQL Generation**: Automatically generates PostgreSQL/PostGIS queries
- **Schema Awareness**: Uses database schema for accurate query generation
- **Query Validation**: Checks for dangerous operations and SQL injection
- **Safe Execution**: Read-only queries with LIMIT enforcement
- **Result Display**: Tabular results with column types

### Supported Providers

| Provider | Description | Configuration |
|----------|-------------|---------------|
| Ollama | Local LLM server | `http://localhost:11434` |
| (Planned) OpenAI | Cloud API | API key required |
| (Planned) Anthropic | Cloud API | API key required |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/query` | POST | Generate and optionally execute SQL |
| `/api/ai/explain` | POST | Explain a SQL query in natural language |
| `/api/ai/execute` | POST | Execute a SQL query safely |
| `/api/ai/providers` | GET | List available LLM providers |

### Query Request

```json
{
  "question": "Show me all countries with population > 1 million",
  "service_name": "mydb",
  "schema_name": "public",
  "max_rows": 100,
  "execute": true
}
```

### Query Response

```json
{
  "success": true,
  "sql": "SELECT name, population FROM countries WHERE population > 1000000 LIMIT 100",
  "confidence": 0.85,
  "warnings": [],
  "result": {
    "columns": [{"name": "name", "type": "text"}, {"name": "population", "type": "integer"}],
    "rows": [...],
    "row_count": 42,
    "duration_ms": 15.5
  }
}
```

### Safety Features

- **Read-only mode**: Only SELECT queries allowed by default
- **LIMIT enforcement**: Automatic LIMIT clause added to prevent large result sets
- **Query validation**: Checks for DROP, DELETE, TRUNCATE, UPDATE without WHERE
- **Timeout protection**: 30-second query timeout
- **SQL injection detection**: Pattern-based detection of common injection techniques

### TUI Usage

The AI Query component can be accessed from PostgreSQL service nodes. It provides:
- Multi-line question input
- Generated SQL preview with syntax highlighting
- Confidence indicator
- Warning display
- Result table viewer

### Web UI Usage

The AI Query Panel provides:
- Question input with example suggestions
- Auto-execute toggle
- SQL preview with execute button
- Confidence badge (color-coded)
- Scrollable results table
- Provider status indicator

---

## Visual Query Designer

The application provides a Metabase-style visual query builder for constructing SQL queries without writing code.

### Features

- **Schema Browser**: Navigate database schemas and tables
- **Column Selection**: Pick columns with optional aggregates (COUNT, SUM, AVG, MIN, MAX)
- **PostGIS Aggregates**: ST_Extent, ST_Union, ST_Collect for spatial aggregations
- **Condition Builder**: Visual WHERE clause builder with multiple operators
- **Join Support**: INNER, LEFT, RIGHT, FULL OUTER, and CROSS joins
- **Ordering**: Multi-column ORDER BY with ASC/DESC and NULLS FIRST/LAST
- **Pagination**: LIMIT and OFFSET controls
- **SQL Preview**: Live SQL generation as you build
- **Query Execution**: Execute and view results inline
- **Query Saving**: Save query definitions for later reuse

### Supported Operators

| Category | Operators |
|----------|-----------|
| Comparison | `=`, `!=`, `<`, `<=`, `>`, `>=` |
| Text | `LIKE`, `ILIKE` |
| Null | `IS NULL`, `IS NOT NULL` |
| Set | `IN`, `NOT IN`, `BETWEEN` |
| PostGIS | `ST_Intersects`, `ST_Contains`, `ST_Within`, `ST_DWithin`, `ST_Equals`, `ST_Touches`, `ST_Overlaps`, `ST_Crosses` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/query/build` | POST | Generate SQL from visual definition |
| `/api/query/execute` | POST | Execute visual query and return results |
| `/api/query/save` | POST | Save query definition |
| `/api/query/list` | GET | List saved queries (filter by service) |
| `/api/query/delete` | DELETE | Delete a saved query |

### Query Definition Schema

```json
{
  "name": "My Query",
  "schema": "public",
  "table": "countries",
  "columns": [
    {"name": "name", "alias": "country_name"},
    {"name": "population", "aggregate": "SUM", "alias": "total_pop"}
  ],
  "joins": [
    {
      "type": "LEFT JOIN",
      "table": "regions",
      "schema": "public",
      "on_left": "countries.region_id",
      "on_right": "regions.id",
      "on_operator": "="
    }
  ],
  "conditions": [
    {"column": "population", "operator": ">", "value": 1000000, "logic": "AND"}
  ],
  "group_by": ["name"],
  "order_by": [{"column": "name", "direction": "ASC"}],
  "limit": 100,
  "distinct": false
}
```

### TUI Usage

The Visual Query Designer in TUI provides:
- Tab-based navigation between sections (Table, Columns, Conditions, Order By, SQL)
- List-based selection for tables and columns
- Live SQL preview
- Execute with Ctrl+E from any section
- Results displayed in scrollable viewport

### Web UI Usage

The QueryDesigner component provides:
- Schema/table dropdown selection
- Checkbox-based column selection with aggregate dropdowns
- Dynamic condition rows with operator selection
- Order by configuration with direction toggles
- SQL preview panel with syntax highlighting
- Inline results table with pagination info
- Save query dialog for reuse

---

## SQL View Layers

The application allows publishing SQL queries (from the Visual Query Designer or AI Query Engine) as GeoServer SQL View layers. This creates virtual layers that execute the query in real-time.

### Features

- **Publish Queries as Layers**: Convert any SQL query into a WMS/WFS layer
- **PostGIS Store Selection**: Choose which PostGIS data store to create the view in
- **Geometry Configuration**: Specify geometry column, type, and SRID
- **Parameterized Views**: Support for query parameters with validation
- **Auto-detection**: Automatic detection of geometry columns from the SQL query
- **Update Support**: Modify the SQL of existing views without recreating

### SQL View Configuration

| Field | Description | Required |
|-------|-------------|----------|
| `layer_name` | Name of the layer in GeoServer | Yes |
| `title` | Human-readable title | No |
| `abstract` | Description of the layer | No |
| `sql` | The SQL SELECT query | Yes |
| `geometry_column` | Name of the geometry column in results | Yes |
| `geometry_type` | PostGIS geometry type (Point, Polygon, etc.) | Yes |
| `srid` | Spatial Reference ID (e.g., 4326) | Yes |
| `key_column` | Primary key for WFS performance | No |
| `parameters` | Query parameters with validators | No |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sqlview` | POST | Create a new SQL View layer |
| `/api/sqlview/{conn}/{ws}/{layer}` | PUT | Update existing SQL View |
| `/api/sqlview/{conn}/{ws}/{layer}` | DELETE | Delete SQL View layer |
| `/api/sqlview/datastores` | GET | List PostGIS data stores |
| `/api/sqlview/detect` | POST | Auto-detect geometry info |

### Create Request

```json
{
  "connection_id": "conn_1",
  "workspace": "myworkspace",
  "datastore": "postgis_store",
  "layer_name": "population_view",
  "title": "Population by Region",
  "abstract": "Aggregated population data",
  "sql": "SELECT region, SUM(population) as total_pop, ST_Union(geom) as geom FROM census GROUP BY region",
  "geometry_column": "geom",
  "geometry_type": "MultiPolygon",
  "srid": 4326,
  "key_column": "region"
}
```

### Create Response

```json
{
  "success": true,
  "layer_name": "population_view",
  "workspace": "myworkspace",
  "datastore": "postgis_store",
  "sql": "SELECT ...",
  "wms_endpoint": "http://geoserver/geoserver/wms?...",
  "wfs_endpoint": "http://geoserver/geoserver/wfs?..."
}
```

### Security Considerations

- SQL is validated to ensure it's a SELECT query only
- Dangerous operations (DROP, DELETE, UPDATE, etc.) are blocked
- SQL injection patterns are detected and rejected
- Read-only execution context in GeoServer

### TUI Usage

The SQL View Wizard provides a step-by-step process:
1. Select GeoServer connection
2. Choose workspace
3. Select PostGIS data store
4. Configure layer name and metadata
5. Set geometry column, type, and SRID
6. Review and create

### Web UI Usage

The SQLViewPublisher component provides:
- Connection/workspace/datastore dropdowns
- Layer configuration form
- SQL preview panel
- Geometry auto-detection button
- Real-time validation
- Success confirmation with WMS/WFS links

---

## SQL Editor

The application provides an advanced SQL editor component with syntax highlighting and intelligent autocompletion.

### Features

- **Syntax Highlighting**: Full PostgreSQL syntax highlighting with keyword colorization
- **Keyword Completion**: All PostgreSQL keywords (SELECT, FROM, WHERE, JOIN, etc.)
- **Function Completion**: PostgreSQL built-in functions (COUNT, SUM, SUBSTRING, etc.)
- **PostGIS Functions**: Complete PostGIS function library (ST_Intersects, ST_Buffer, ST_Transform, etc.)
- **Schema-aware Completion**: Dynamically loads schema information for table and column suggestions
- **Type Completion**: PostgreSQL data types (integer, text, geometry, etc.)
- **Line Numbers**: Optional line number gutter
- **Read-only Mode**: View-only mode for displaying generated SQL

### Autocompletion Categories

| Category | Examples | Boost Priority |
|----------|----------|----------------|
| Columns | `name`, `geom`, `population` | Highest (15) |
| Tables | `countries`, `cities`, `roads` | High (8-10) |
| Schemas | `public`, `topology`, `tiger` | Medium-High (6) |
| Keywords | `SELECT`, `FROM`, `WHERE` | Medium (5) |
| PostGIS Functions | `ST_Intersects()`, `ST_Buffer()` | Medium (4) |
| PostgreSQL Functions | `COUNT()`, `SUM()`, `LOWER()` | Medium (3) |
| Data Types | `integer`, `geometry`, `text` | Low (1) |

### Context-aware Completion

The editor provides intelligent completion based on context:

- **After schema dot**: Suggests tables in that schema (e.g., `public.` → table names)
- **After table dot**: Suggests columns in that table (e.g., `countries.` → column names)
- **Partial match**: Filters options based on typed characters

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pg/services/{name}/schemas` | GET | Get schema info for autocompletion |

### Schema Response

```json
{
  "schemas": [
    {
      "name": "public",
      "tables": [
        {
          "name": "countries",
          "schema": "public",
          "columns": [
            {"name": "id", "type": "integer", "nullable": false},
            {"name": "name", "type": "text", "nullable": true},
            {"name": "geom", "type": "geometry", "nullable": true}
          ]
        }
      ]
    }
  ]
}
```

### Web UI Components Using SQL Editor

- **QueryDesigner**: Visual query builder with SQL preview/edit mode
- **AIQueryPanel**: AI-generated SQL display with edit capability
- **SQLViewPublisher**: SQL input for creating GeoServer views

### Usage

```tsx
<SQLEditor
  value={sql}
  onChange={setSQL}
  height="150px"
  serviceName="my_pg_service"  // Enables schema-aware completion
  readOnly={false}
  placeholder="Enter SQL query..."
/>
```

---

## UI Animation System

The Web UI features a comprehensive physics-based animation system that creates a delightful, engaging user experience with purposeful motion.

### Design Philosophy

- **Purposeful Motion**: Animations guide user attention and communicate state changes
- **Spring Physics**: Natural, organic movement using spring dynamics (stiffness, damping, mass)
- **Micro-interactions**: Subtle feedback on hover, tap, and state changes
- **Delightful Surprises**: Occasional celebratory moments (confetti, sparkles) for achievements
- **Flow State**: Smooth transitions support user focus and confidence

### Animation Utilities

Located in `web/src/utils/animations.ts`:

| Category | Examples |
|----------|----------|
| Spring Configs | `gentle`, `default`, `snappy`, `bouncy`, `wobbly`, `stiff` |
| Modal Transitions | `modalBackdrop`, `modalContent`, `slideUp`, `slideDown` |
| List Animations | `staggerContainer`, `staggerItem`, `listItemHover` |
| Tree Animations | `treeNodeExpand`, `treeChevron` |
| Feedback | `successPop`, `errorShake`, `warningPulse` |
| Special Effects | `confettiBurst`, `sparkle`, `heartbeat`, `wiggle` |

### Animated Components

Located in `web/src/components/AnimatedComponents.tsx`:

| Component | Purpose |
|-----------|---------|
| `AnimatedModal` | Physics-based modal with backdrop blur |
| `AnimatedButton` | Hover/tap feedback with loading states |
| `AnimatedCard` | Hover elevation and entry animation |
| `AnimatedList` | Staggered entry for list items |
| `AnimatedExpandable` | Smooth expand/collapse sections |
| `AnimatedChevron` | Rotating indicator for expandable items |
| `AnimatedCheckmark` | Celebratory success indicator |
| `AnimatedError` | Shake animation for errors |
| `AnimatedToast` | Slide-in notifications |
| `AnimatedProgress` | Spring-based progress bar |
| `AnimatedCounter` | Animated number transitions |
| `Confetti` | Celebration particle effects |
| `SparkleWrapper` | Ambient sparkle effects |
| `PulsingDot` | Status indicators |

### Spring Configurations

```typescript
// Gentle, relaxed motion for ambient elements
gentle: { stiffness: 120, damping: 14, mass: 1 }

// Default spring for most UI elements
default: { stiffness: 300, damping: 24, mass: 1 }

// Snappy response for interactive elements
snappy: { stiffness: 400, damping: 28, mass: 0.8 }

// Bouncy for playful elements
bouncy: { stiffness: 500, damping: 15, mass: 1 }
```

### Usage Example

```tsx
import { motion } from 'framer-motion';
import { modalContent, springs } from '../utils/animations';

<motion.div
  variants={modalContent}
  initial="hidden"
  animate="visible"
  exit="exit"
>
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    transition={springs.snappy}
  >
    Click me
  </motion.button>
</motion.div>
```

---

## GeoWebCache (Tile Caching)

The application provides comprehensive management of GeoWebCache (GWC), GeoServer's built-in tile caching system.

### Features

- **Layer Cache Management**: View and manage cached layers
- **Seeding Operations**: Pre-generate tiles for faster map viewing
- **Truncation**: Delete cached tiles to force regeneration
- **Disk Quota Management**: Configure storage limits
- **Grid Set Configuration**: Manage tile grid schemes (TMS)
- **Real-time Progress**: Monitor seeding operations in real-time

### Seeding Operations

| Operation | Description |
|-----------|-------------|
| Seed | Pre-generate tiles for a layer within specified bounds |
| Reseed | Regenerate existing tiles (updates outdated caches) |
| Truncate | Delete all cached tiles for a layer |

### Seed Configuration

| Parameter | Description |
|-----------|-------------|
| Zoom Start | Starting zoom level for tile generation |
| Zoom Stop | Ending zoom level for tile generation |
| Grid Set | Tile grid scheme (e.g., EPSG:4326, EPSG:900913) |
| Bounds | Optional bounding box to limit seeding area |
| Thread Count | Number of parallel seeding threads |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gwc/layers/{connId}` | GET | List all cached layers |
| `/api/gwc/layers/{connId}/{layer}` | GET | Get layer cache info |
| `/api/gwc/seed/{connId}/{layer}` | POST | Start seeding operation |
| `/api/gwc/seed/{connId}/{layer}` | GET | Get seed operation status |
| `/api/gwc/seed/{connId}/{layer}` | DELETE | Stop seeding operation |
| `/api/gwc/seed/{connId}` | DELETE | Stop all seeding operations |
| `/api/gwc/truncate/{connId}/{layer}` | POST | Truncate layer cache |
| `/api/gwc/gridsets/{connId}` | GET | List grid sets |
| `/api/gwc/gridsets/{connId}/{gridset}` | GET | Get grid set details |
| `/api/gwc/diskquota/{connId}` | GET | Get disk quota settings |
| `/api/gwc/diskquota/{connId}` | PUT | Update disk quota settings |

### Web UI (CacheDialog)

The Cache Dialog provides:
- Visual progress bars for seeding operations
- Zoom level range slider
- Grid set dropdown selection
- Bounding box input (optional)
- Real-time status updates
- Stop individual or all operations

---

## Server Synchronization

The application supports synchronizing GeoServer configurations between multiple servers, enabling easy migration and replication of resources.

### Features

- **Multi-destination Sync**: Sync from one source to multiple destinations
- **Selective Resource Sync**: Choose which resources to sync (workspaces, stores, layers, styles, groups)
- **Additive Mode**: Only adds/updates resources, never deletes (non-destructive)
- **Named Configurations**: Save sync setups for repeated use
- **Real-time Progress**: Per-destination progress tracking
- **Visual Feedback**: Animated UI with pulsing icons and flowing arrows

### Sync Configuration

| Field | Description |
|-------|-------------|
| Name | Configuration name for reuse |
| Source | Source GeoServer connection |
| Destinations | One or more target GeoServer connections |
| Resources | Workspaces, data stores, coverage stores, layers, styles, layer groups |

### Sync Behavior

- Creates missing workspaces on destination
- Creates missing stores with connection parameters
- Publishes missing layers
- Copies styles (SLD content)
- Recreates layer groups
- Skips resources that already exist (by name)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync/configs` | GET | List saved sync configurations |
| `/api/sync/configs` | POST | Create new sync configuration |
| `/api/sync/configs/{id}` | GET | Get specific configuration |
| `/api/sync/configs/{id}` | PUT | Update configuration |
| `/api/sync/configs/{id}` | DELETE | Delete configuration |
| `/api/sync/start` | POST | Start sync operation |
| `/api/sync/status` | GET | Get overall sync status |
| `/api/sync/status/{syncId}` | GET | Get specific sync status |
| `/api/sync/stop` | POST | Stop all sync operations |
| `/api/sync/stop/{syncId}` | DELETE | Stop specific sync operation |

### Web UI (SyncDialog)

The Sync Dialog provides:
- Drag-drop interface for selecting source/destinations
- Resource type checkboxes
- Per-destination progress bars
- Activity log with timestamps
- Stop controls for individual or all syncs
- Animated visual feedback

---

## Layer Metadata Management

The application provides comprehensive layer metadata editing capabilities for GeoServer layers.

### Editable Metadata Fields

| Category | Fields |
|----------|--------|
| Basic Info | Title, Abstract, Keywords |
| Attribution | Attribution text, Logo URL, Attribution Title |
| Coordinate Systems | Native SRS, Declared SRS |
| Bounding Boxes | Lat/Lon bounds, Native bounds |
| Service Config | Service enable/disable toggles |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/layermetadata/{connId}/{workspace}/{layer}` | GET | Get comprehensive metadata |
| `/api/layermetadata/{connId}/{workspace}/{layer}` | PUT | Update metadata |
| `/api/layers/{connId}/{workspace}/{layer}/feature-count` | GET | Get feature count (vector) |

### Web UI

The Layer Metadata panel displays:
- Full layer information in organized sections
- Inline editing for supported fields
- Service endpoint URLs (WMS, WFS, WCS)
- Bounding box visualization
- Feature count for vector layers

---

## Layer Groups

The application supports creating and managing GeoServer layer groups, which bundle multiple layers for combined rendering.

### Features

- **Group Creation**: Create new layer groups from existing layers
- **Layer Ordering**: Control draw order of member layers
- **Style Assignment**: Assign styles to each member layer
- **Nested Groups**: Support for layer groups containing other groups

### Group Configuration

| Field | Description |
|-------|-------------|
| Name | Unique identifier for the group |
| Title | Human-readable display name |
| Abstract | Description of the group |
| Mode | SINGLE, OPAQUE_CONTAINER, NAMED, CONTAINER, EO |
| Bounds | Combined bounds of all member layers |
| Layers | Ordered list of member layers with styles |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/layergroups/{connId}/{workspace}` | GET | List layer groups |
| `/api/layergroups/{connId}/{workspace}` | POST | Create layer group |
| `/api/layergroups/{connId}/{workspace}/{group}` | GET | Get group details |
| `/api/layergroups/{connId}/{workspace}/{group}` | PUT | Update layer group |
| `/api/layergroups/{connId}/{workspace}/{group}` | DELETE | Delete layer group |

### Web UI (LayerGroupDialog)

The Layer Group Dialog provides:
- Layer selection from workspace
- Drag-drop reordering
- Style assignment per layer
- Preview of combined rendering

---

## Dashboard & Monitoring

The application provides a dashboard view for monitoring all connected servers and their resources.

### Features

- **Multi-server Overview**: Summary of all GeoServer connections
- **Resource Counts**: Workspaces, layers, styles, stores per server
- **Connection Status**: Online/offline indicators with response times
- **Quick Actions**: Context-aware action buttons
- **PostgreSQL Services**: Service status and statistics

### Dashboard Metrics

| Metric | Description |
|--------|-------------|
| Server Version | GeoServer version information |
| Workspace Count | Number of workspaces |
| Layer Count | Total published layers |
| Style Count | Total styles defined |
| Store Count | Data stores + coverage stores |
| GWC Disk Usage | Cached tile storage size |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Multi-server dashboard data |
| `/api/dashboard/server` | GET | Single server status |
| `/api/server/{connId}/info` | GET | Detailed server information |
| `/api/connections/{id}/info` | GET | Connection-specific info |

### Web UI

The Dashboard component displays:
- Server cards with status indicators
- Animated connection state
- Quick navigation to resources
- PostgreSQL service cards
- Upload buttons (context-aware based on selection)

---

## Raster Data Import

The application supports importing raster data into PostgreSQL using PostGIS raster support via raster2pgsql.

### Supported Formats

| Extension | Format |
|-----------|--------|
| `.tif`, `.tiff` | GeoTIFF |
| `.gpkg` | GeoPackage (raster tiles) |
| `.png`, `.jpg` | World-file georeferenced images |

### Import Options

| Option | Description |
|--------|-------------|
| Target Schema | PostgreSQL schema to import into |
| Table Name | Name for the raster table |
| SRID | Spatial Reference ID for the raster |
| Tile Size | Tile dimensions (e.g., 256x256) |
| Overwrite | Replace existing table if exists |
| Overview Levels | Generate pyramid levels for performance |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pg/import/raster` | POST | Start raster import |
| `/api/pg/import/upload` | POST | Upload file for import |
| `/api/pg/import/{jobId}` | GET | Get import job status |

### Web UI (PGUploadDialog)

The PostgreSQL Upload Dialog supports:
- File type auto-detection (vector vs raster)
- Layer selection for multi-layer files
- Custom table naming
- Progress tracking
- Post-import layer detection

---

## PostgreSQL Table Data Viewer

The application provides an interactive data viewer for browsing PostgreSQL table contents with infinite scroll.

### Features

- **Infinite Scroll**: Load data progressively as you scroll
- **Column Headers**: Display column names with type information
- **Null Handling**: Display `-` for NULL values
- **Row Numbering**: Show row index for reference
- **CSV Export**: Export visible data to CSV file
- **Refresh**: Reload data from database
- **SQL Query**: Open Query Designer for the table

### Display Options

- Automatic column width adjustment
- Truncation of long values with ellipsis
- JSON/JSONB pretty formatting
- Geometry column handling (shows WKT summary)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/query/execute` | POST | Execute query with pagination |

The data viewer uses the query execute endpoint with:
```json
{
  "sql": "SELECT * FROM \"schema\".\"table\"",
  "service_name": "pg_service",
  "max_rows": 100,
  "offset": 0
}
```

### Web UI (PGTablePanel)

The PostgreSQL Table Panel displays:
- Header card with table name and row count
- Sticky column headers during scroll
- Infinite scroll loading indicator
- Export CSV and SQL Query buttons
- Full-height table filling available space

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

## S3 Storage Integration

The application provides comprehensive integration with S3-compatible object storage services, enabling cloud-based geospatial data management.

### Supported Providers

| Provider | Description | Configuration Notes |
|----------|-------------|---------------------|
| MinIO | Open-source S3-compatible storage | Path style, no SSL for local |
| AWS S3 | Amazon Simple Storage Service | Virtual-hosted style, SSL required |
| Wasabi | Hot cloud storage | S3-compatible API |
| Backblaze B2 | Cloud storage with S3 API | S3-compatible endpoint |
| DigitalOcean Spaces | Object storage | S3-compatible API |
| Any S3-compatible | Custom S3 implementations | Configurable endpoint |

### Connection Configuration

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Display name for the connection | Yes |
| `endpoint` | S3 endpoint URL (e.g., `localhost:9000`, `s3.amazonaws.com`) | Yes |
| `accessKey` | Access key ID for authentication | Yes |
| `secretKey` | Secret access key | Yes |
| `region` | AWS region (required for AWS S3) | No |
| `useSSL` | Enable HTTPS connection | No (default: false) |
| `pathStyle` | Use path-style addressing (required for MinIO) | No (default: true) |

### Features

- **Connection Management**: Add, edit, test, and remove S3 connections
- **Bucket Operations**: Create, list, and delete buckets
- **Object Management**: Upload, download, delete objects with folder organization
- **Presigned URLs**: Generate temporary access URLs for direct download
- **Progress Tracking**: Real-time upload progress with percentage display
- **Cloud-Native Conversion**: Automatic format conversion during upload

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/s3/connections` | GET | List all S3 connections |
| `/api/s3/connections` | POST | Create new S3 connection |
| `/api/s3/connections/{id}` | GET | Get connection details |
| `/api/s3/connections/{id}` | PUT | Update S3 connection |
| `/api/s3/connections/{id}` | DELETE | Delete S3 connection |
| `/api/s3/connections/{id}/test` | POST | Test existing connection |
| `/api/s3/connections/test` | POST | Test connection credentials |
| `/api/s3/buckets/{connId}` | GET | List buckets |
| `/api/s3/buckets/{connId}` | POST | Create bucket |
| `/api/s3/buckets/{connId}/{bucket}` | DELETE | Delete bucket |
| `/api/s3/objects/{connId}/{bucket}` | GET | List objects (with prefix) |
| `/api/s3/objects/{connId}/{bucket}` | POST | Upload object |
| `/api/s3/objects/{connId}/{bucket}/{key}` | DELETE | Delete object |
| `/api/s3/presign/{connId}/{bucket}/{key}` | GET | Get presigned URL |

### Upload with Conversion

When uploading files, the system can automatically suggest and perform cloud-native format conversion:

```json
POST /api/s3/objects/{connId}/{bucket}
Content-Type: multipart/form-data

file: <binary data>
key: path/to/file.tif
convert: true
targetFormat: cog
```

### Response Format

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "key": "path/to/file.cog.tif",
  "size": 1234567,
  "conversionJobId": "job-uuid-here"
}
```

### Web UI Components

- **S3ConnectionDialog**: Create/edit S3 connections with test functionality
- **S3UploadDialog**: Upload files with conversion options and progress
- **S3ConnectionPanel**: Dashboard showing buckets, conversion tools, and stats
- **S3StorageRootNode**: Tree node for S3 storage container
- **S3ConnectionNode**: Tree node for individual S3 connections
- **S3BucketNode**: Tree node for S3 buckets
- **S3ObjectNode**: Tree node for S3 objects with preview/download actions

### TUI Support

- S3 Storage section in unified resource tree
- S3 connection nodes with bucket expansion
- Object browsing with folder structure
- (Planned) S3 connection wizard
- (Planned) Upload to S3 from file browser

### MinIO Development Testbed

For local development, a MinIO Docker container can be started:

```bash
# In nix shell
minio-start     # Start MinIO container
minio-status    # Check container status
minio-console   # Open MinIO web console
minio-creds     # Show access credentials
minio-mc        # Open MinIO CLI (mc)
minio-stop      # Stop container
minio-clean     # Remove container and volumes
```

Default credentials:
- **Access Key**: `minioadmin`
- **Secret Key**: `minioadmin`
- **API Port**: `9000`
- **Console Port**: `9001`
- **Default Bucket**: `geospatial-data`

---

## Cloud-Native Format Conversion

The application supports converting geospatial data to cloud-native formats optimized for streaming and partial access.

### Supported Conversions

| Source Format | Target Format | Tool | Description |
|---------------|---------------|------|-------------|
| GeoTIFF, TIFF, PNG, JPG | COG | GDAL | Cloud Optimized GeoTIFF |
| LAS, LAZ, E57, PLY | COPC | PDAL | Cloud Optimized Point Cloud |
| Shapefile, GeoJSON, GeoPackage, KML | GeoParquet | ogr2ogr | Cloud-optimized vector format |

### Cloud Optimized GeoTIFF (COG)

- Uses GDAL's `gdal_translate` with `-of COG` driver
- Supports multiple compression options (LZW, DEFLATE, ZSTD, JPEG, WEBP)
- Configurable overview resampling (NEAREST, BILINEAR, CUBIC, etc.)
- Configurable block size for optimal streaming

### Cloud Optimized Point Cloud (COPC)

- Uses PDAL `translate` command with COPC writer
- Produces `.copc.laz` files with spatial indexing
- Supports multi-threaded processing
- Compatible with Potree and other COPC viewers

### GeoParquet

- Uses ogr2ogr with Parquet driver
- WKB geometry encoding for efficiency
- ZSTD compression by default
- Compatible with DuckDB, Apache Arrow, and Python geospatial libraries

### Conversion Job Management

Jobs are managed asynchronously with status tracking:

| Status | Description |
|--------|-------------|
| `pending` | Job queued for processing |
| `running` | Conversion in progress |
| `completed` | Successfully converted |
| `failed` | Conversion failed with error |
| `cancelled` | Job cancelled by user |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conversion/tools` | GET | Check tool availability (GDAL, PDAL, ogr2ogr) |
| `/api/conversion/jobs` | GET | List all conversion jobs |
| `/api/conversion/jobs/{id}` | GET | Get job status and progress |
| `/api/conversion/jobs/{id}` | DELETE | Cancel running job |

### Tool Status Response

```json
{
  "gdal": {
    "available": true,
    "version": "GDAL 3.8.0",
    "tool": "gdal_translate",
    "formats": ["COG", "GeoTIFF", "PNG", "JPEG"]
  },
  "pdal": {
    "available": true,
    "version": "PDAL 2.6.0",
    "tool": "pdal",
    "formats": ["COPC", "LAS", "LAZ"]
  },
  "ogr2ogr": {
    "available": true,
    "version": "GDAL 3.8.0",
    "tool": "ogr2ogr",
    "formats": ["GeoParquet", "Shapefile", "GeoJSON", "GeoPackage", "Parquet"]
  }
}
```

### Web UI Components

- **Conversion Tool Status**: Visual indicators in S3ConnectionPanel showing tool availability
- **Upload Dialog Conversion Options**: Toggle conversion and select target format during upload
- **Progress Tracking**: Real-time conversion progress in upload dialog

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
10. ~~**Embedded TerriaMap**: Self-hosted Terria viewer~~ (Implemented - built-in Cesium viewer)
11. ~~**PostgreSQL Integration**: pg_service.conf support~~ (Implemented in v0.8.0)
12. ~~**Data Import**: ogr2ogr-based import~~ (Implemented in v0.8.0)
13. ~~**PG to GeoServer Bridge**: PostGIS store creation~~ (Implemented in v0.8.0)
14. ~~**AI Query Engine**: Natural language to SQL~~ (Implemented in v0.8.0)
15. ~~**Visual Query Designer**: Metabase-style query builder~~ (Implemented in v0.9.0)
16. ~~**SQL View Layers**: Publish queries as GeoServer layers~~ (Implemented in v0.9.0)
17. ~~**GeoWebCache Management**: Tile seeding and truncation~~ (Implemented in v0.13.0)
18. ~~**Server Synchronization**: Multi-server sync~~ (Implemented in v0.13.0)
19. ~~**Raster Import**: PostGIS raster support via raster2pgsql~~ (Implemented in v0.13.0)

### Known Limitations

1. GeoTIFF verification not supported (requires WCS integration)
2. Large file uploads may timeout (30-second default)
3. No support for cascading WMS stores (read-only)
4. Password stored in plaintext in config file
5. AI Query requires local Ollama server running

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
| 0.8.0 | 2025 | Renamed to Kartoza CloudBench, PostgreSQL integration, ogr2ogr import, PG to GeoServer bridge |
| 0.9.0 | 2025 | Visual Query Designer with SQL generation, PostGIS support, query saving |
| 0.10.0 | 2025 | SQL View Layers: publish queries as GeoServer WMS/WFS layers |
| 0.11.0 | 2025 | SQL Editor with syntax highlighting and schema-aware autocompletion |
| 0.12.0 | 2025 | Physics-based UI animations with spring motion, micro-interactions |
| 0.13.0 | 2025 | GeoWebCache management, server synchronization, layer groups, dashboard |
| 0.14.0 | 2025 | PostgreSQL raster import, table data viewer with infinite scroll, embedded 3D viewer |
| 0.15.0 | 2025 | S3 storage integration (MinIO, AWS S3, Wasabi), cloud-native format conversion (COG, COPC, GeoParquet) |

---

*This specification is maintained alongside the codebase and should be updated as features are added or modified.*
