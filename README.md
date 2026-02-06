# Kartoza GeoServer Client

A Midnight Commander-style TUI (Terminal User Interface) for managing GeoServer instances. Browse local geospatial files and upload them to GeoServer with ease.

![Go Version](https://img.shields.io/badge/Go-1.23+-00ADD8?style=flat&logo=go)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## Features

- **Dual-panel interface** - Local filesystem on the left, GeoServer explorer on the right
- **Connection manager** - Store and manage multiple GeoServer connections with credentials
- **Geospatial file detection** - Automatically identifies Shapefiles, GeoPackage, GeoTIFF, GeoJSON, SLD, and CSS files
- **GeoServer hierarchy browser** - Navigate workspaces, data stores, coverage stores, layers, styles, and layer groups
- **Upload support** - Upload local files to GeoServer and publish as services
- **CRUD operations** - Create, edit, and delete workspaces, data stores, and coverage stores
- **Animated dialogs** - Smooth spring-based animations using Harmonica physics
- **Vim-style navigation** - Use familiar j/k keys for navigation

## Installation

### Using Nix (recommended)

```bash
nix run github:kartoza/kartoza-geoserver-client
```

### From source

```bash
git clone https://github.com/kartoza/kartoza-geoserver-client.git
cd kartoza-geoserver-client
go build -o geoserver-client .
./geoserver-client
```

### Development

```bash
nix develop  # Enter development shell
go run .     # Run the application
```

## Usage

### Keyboard Shortcuts

#### Global
| Key | Action |
|-----|--------|
| `Tab` | Switch between panels |
| `?` / `F1` | Toggle help |
| `q` / `Ctrl+C` | Quit |

#### Navigation
| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` / `l` | Open / Expand |
| `Backspace` / `h` | Go back / Collapse |
| `PgUp` / `PgDn` | Page up / down |
| `Home` / `End` | Go to start / end |

#### Actions
| Key | Action |
|-----|--------|
| `Space` | Select file |
| `c` | Open connection manager |
| `u` | Upload selected files |
| `r` | Refresh current view |

#### Connection Manager
| Key | Action |
|-----|--------|
| `a` | Add new connection |
| `e` | Edit connection |
| `d` | Delete connection |
| `t` | Test connection |
| `Enter` | Connect to selected |

#### GeoServer Tree (CRUD Operations)
| Key | Action |
|-----|--------|
| `n` | Create new item (workspace, store) |
| `e` | Edit/rename selected item |
| `d` | Delete selected item |

#### Store Creation Wizard
When creating a data store or coverage store, a wizard guides you through:
1. **Type Selection** - Choose the store type (PostGIS, Shapefile Directory, GeoPackage, etc.)
2. **Configuration** - Enter the required connection parameters for your chosen type

Supported Data Store Types:
- **PostGIS** - Connect to PostgreSQL/PostGIS databases
- **Directory of Shapefiles** - Reference a folder containing shapefiles
- **GeoPackage** - Connect to GeoPackage files
- **Web Feature Service (WFS)** - Connect to external WFS services

Supported Coverage Store Types (Raster):
- **GeoTIFF** - Single GeoTIFF raster file
- **World Image** - PNG/JPEG/GIF with world file (.pgw, .jgw, .gfw)
- **Image Mosaic** - Directory of images forming a mosaic
- **Image Pyramid** - Multi-resolution image pyramid
- **ArcGrid** - ESRI ASCII Grid format (.asc)
- **GeoPackage (Raster)** - Raster tiles in GeoPackage format

#### Form Editing (vim-style)
| Key | Action |
|-----|--------|
| `j` / `k` | Navigate between fields |
| `Enter` | Edit field / Accept value |
| `Esc` | Cancel edit / Go back |
| `Ctrl+S` | Save form |

## Configuration

Configuration is stored in `~/.config/kartoza-geoserver-client/config.json`:

```json
{
  "connections": [
    {
      "id": "uuid",
      "name": "My GeoServer",
      "url": "https://geoserver.example.com/geoserver",
      "username": "admin",
      "password": "geoserver"
    }
  ],
  "active_connection": "uuid",
  "last_local_path": "/home/user/geodata"
}
```

## Supported File Types

| Type | Extensions | Upload Target |
|------|------------|---------------|
| Shapefile | `.shp`, `.zip` | Data Store |
| GeoPackage | `.gpkg` | Data Store |
| GeoTIFF | `.tif`, `.tiff` | Coverage Store |
| GeoJSON | `.geojson`, `.json` | Data Store |
| SLD Style | `.sld` | Styles |
| CSS Style | `.css` | Styles |

## GeoServer REST API

This client uses the GeoServer REST API for all operations. Ensure your GeoServer instance has the REST API enabled and your user has appropriate permissions.

### Required Permissions

- Read access to workspaces, stores, layers, and styles
- Write access for uploading data and creating resources

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Bubble Tea](https://github.com/charmbracelet/bubbletea) - A powerful TUI framework
- Styled with [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Style definitions for terminal apps
- Animated with [Harmonica](https://github.com/charmbracelet/harmonica) - Physics-based animations
- Inspired by [Midnight Commander](https://midnight-commander.org/)
