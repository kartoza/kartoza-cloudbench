#!/usr/bin/env bash
set -euo pipefail

# Setup script for TerriaMap static files
# This downloads and configures TerriaMapStatic for use with Kartoza GeoServer Client

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TERRIA_DIR="$PROJECT_DIR/internal/terria/static"
TERRIA_REPO="https://github.com/TerriaJS/TerriaMap.git"
TERRIA_STATIC_REPO="https://github.com/JJediny/TerriaMapStatic.git"

echo "=== Kartoza GeoServer Client - Terria Setup ==="
echo ""

# Check for required tools
check_requirements() {
    local missing=()

    if ! command -v git &> /dev/null; then
        missing+=("git")
    fi

    if ! command -v node &> /dev/null; then
        missing+=("node")
    fi

    if ! command -v yarn &> /dev/null && ! command -v npm &> /dev/null; then
        missing+=("yarn or npm")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo "Error: Missing required tools: ${missing[*]}"
        echo "Please install them and try again."
        exit 1
    fi
}

# Option 1: Use pre-built TerriaMapStatic (faster, but may be outdated)
setup_static() {
    echo "Downloading pre-built TerriaMapStatic..."

    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    git clone --depth 1 "$TERRIA_STATIC_REPO" "$TEMP_DIR/terria"

    # Copy static files, preserving our custom files
    echo "Copying static files..."

    # Backup our custom index.html
    if [ -f "$TERRIA_DIR/index.html" ]; then
        cp "$TERRIA_DIR/index.html" "$TERRIA_DIR/index.html.backup"
    fi

    # Copy TerriaMapStatic contents
    cp -r "$TEMP_DIR/terria/"* "$TERRIA_DIR/"

    # Create our custom config.json
    create_config

    echo "TerriaMapStatic installed successfully!"
}

# Option 2: Build from source (latest, but takes longer)
setup_from_source() {
    echo "Building TerriaMap from source..."
    echo "This may take several minutes..."

    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    git clone --depth 1 "$TERRIA_REPO" "$TEMP_DIR/terria"
    cd "$TEMP_DIR/terria"

    # Install dependencies
    if command -v yarn &> /dev/null; then
        yarn install
        yarn gulp release
    else
        npm install
        npm run gulp release
    fi

    # Copy built files
    echo "Copying built files..."
    cp -r wwwroot/* "$TERRIA_DIR/"

    # Create our custom config.json
    create_config

    echo "TerriaMap built and installed successfully!"
}

# Create our custom config.json
create_config() {
    cat > "$TERRIA_DIR/config.json" << 'EOF'
{
  "initializationUrls": [],
  "parameters": {
    "appName": "Kartoza GeoServer Viewer",
    "brandBarElements": [
      "<a href=\"/\" style=\"color: white; text-decoration: none;\"><strong>Kartoza GeoServer Client</strong></a>"
    ],
    "supportEmail": "support@kartoza.com",
    "disclaimer": {
      "text": "This viewer is provided by Kartoza GeoServer Client for previewing GeoServer data.",
      "url": "https://github.com/kartoza/kartoza-geoserver-client"
    },
    "globalDisclaimer": {
      "enableOnLocalhost": true,
      "prodHostRegex": "."
    },
    "helpContent": [
      {
        "title": "About",
        "content": "This is the Terria-based 3D viewer integrated with Kartoza GeoServer Client. It allows you to view your GeoServer layers in 2D, 3D, and globe modes."
      }
    ],
    "mobileDefaultViewerMode": "2d",
    "experimentalFeatures": true,
    "useCesiumIonTerrain": false,
    "useCesiumIonBingImagery": false
  }
}
EOF

    # Create a simple init file
    cat > "$TERRIA_DIR/init/kartoza.json" << 'EOF'
{
  "catalog": [],
  "homeCamera": {
    "north": 85,
    "south": -85,
    "east": 180,
    "west": -180
  },
  "viewerMode": "2d",
  "baseMaps": {
    "defaultBaseMapId": "basemap-positron"
  }
}
EOF

    echo "Created custom config.json and init/kartoza.json"
}

# Main menu
main() {
    check_requirements

    echo "Choose setup method:"
    echo "  1) Quick setup (pre-built TerriaMapStatic - faster)"
    echo "  2) Build from source (latest features - slower)"
    echo "  3) Config only (keep existing files, update config)"
    echo ""
    read -p "Enter choice [1-3]: " choice

    case $choice in
        1)
            setup_static
            ;;
        2)
            setup_from_source
            ;;
        3)
            create_config
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac

    echo ""
    echo "=== Setup Complete ==="
    echo ""
    echo "The Terria viewer is now available at:"
    echo "  http://localhost:8081/  (when running the Terria server)"
    echo ""
    echo "You can load GeoServer catalogs using:"
    echo "  http://localhost:8081/#http://localhost:8081/init/CONNECTION_ID.json"
    echo ""
}

main "$@"
