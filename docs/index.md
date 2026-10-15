# Kartoza CloudBench

A comprehensive cloud-native geospatial data management platform with TUI (Terminal User Interface) and Web UI for managing GeoServer, PostgreSQL/PostGIS, S3 storage, and more.

> **New to CloudBench?** Start with [Overview & Workflow](user-guide/overview.md)
> for how the pieces fit together, then
> [On-demand Conversions](user-guide/on-demand-conversions.md) for turning S3
> uploads into cloud-native layers.

## Features

### Web UI
- **Modern React interface** - Beautiful Chakra UI-based web application
- **Tree browser** - Hierarchical view of all GeoServer resources
- **Layer metadata editing** - Comprehensive metadata management
- **GeoWebCache management** - Seed, reseed, and truncate cached tiles
- **Map preview** - Interactive map preview with WMS/WMTS support
- **Chunked file upload** - Upload large geospatial files with progress tracking
- **S3 Storage integration** - Browse and manage cloud-native geospatial data

### TUI (Terminal User Interface)
- **Textual-based interface** - Modern Python TUI with rich widgets
- **Connection manager** - Store and manage multiple GeoServer connections
- **Vim-style navigation** - Familiar keyboard shortcuts

### Integrations
- **GeoServer** - Full REST API management
- **PostgreSQL/PostGIS** - Direct database connections
- **S3/MinIO** - Cloud storage for geospatial data
- **QGIS Server** - Project management and preview
- **Terria/Cesium** - 3D globe visualization

## Quick Start

```bash
# Clone the repository
git clone https://github.com/kartoza/kartoza-cloudbench.git
cd kartoza-cloudbench

# Using Nix (recommended)
nix develop
python manage.py runserver 8080

# Or using pip
pip install -e .
python manage.py migrate
python manage.py runserver 8080
```

Then visit [http://localhost:8080](http://localhost:8080)

## Architecture

CloudBench is built with:

- **Backend**: Python/Django with Django REST Framework
- **Frontend**: React with Chakra UI and Zustand state management
- **TUI**: Python Textual framework
- **Maps**: MapLibre GL JS with CARTO basemaps

## Support

- [GitHub Issues](https://github.com/kartoza/kartoza-cloudbench/issues)
- [Kartoza](https://kartoza.com)

---

Made with 💗 by [Kartoza](https://kartoza.com) | [Donate](https://github.com/sponsors/kartoza) | [GitHub](https://github.com/kartoza/kartoza-cloudbench)
