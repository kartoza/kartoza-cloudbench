# File Uploads

CloudBench supports uploading geospatial data files directly to GeoServer.

## Supported File Types

| Type | Extensions | Target |
|------|------------|--------|
| Shapefile | `.zip` | Data Store |
| GeoPackage | `.gpkg` | Data Store |
| GeoTIFF | `.tif`, `.tiff` | Coverage Store |
| GeoJSON | `.geojson`, `.json` | Data Store |
| SLD Style | `.sld` | Styles |
| CSS Style | `.css` | Styles |

## Uploading Files

### Via Web UI

1. Select a workspace in the tree
2. Click the **Upload** button (arrow icon)
3. Select your file
4. Monitor upload progress
5. Layer is automatically published

### Chunked Uploads

Large files are automatically uploaded in chunks:

- Default chunk size: 5 MB
- Progress tracking per chunk
- Resume capability on failure
- Files up to 10 GB supported

## Upload Process

1. **Initialize**: Create upload session
2. **Upload chunks**: Send file in pieces
3. **Assemble**: Combine chunks on server
4. **Publish**: Create store and layer in GeoServer

## Shapefile Requirements

When uploading shapefiles:

- Package as a ZIP file
- Include all required files:
  - `.shp` - Shape geometry
  - `.shx` - Shape index
  - `.dbf` - Attributes
  - `.prj` - Projection (recommended)

## S3 Cloud-Native Options

For S3 uploads, selecting a `.shp` file or a zipped shapefile (`.zip`) shows
**PMTiles** under **Convert to Cloud-Native** when CloudNativeGIS
is reachable. Cloudbench checks the service from Django using
`CLOUDNATIVEGIS_URL`; an unreachable service hides the option without blocking
normal uploads.

PMTiles is the default recommendation when available, replacing GeoParquet
for shapefile uploads. Select or drag the matching `.shp`, `.shx`, and `.dbf`
files together; include `.prj` for the projection. Cloudbench creates the ZIP
automatically before sending it to CloudNativeGIS. A lone `.shp` is not enough:
the browser cannot automatically read companion files you have not selected.
You can also supply an existing ZIP with exactly one shapefile. Nested shapefile
folders in ZIPs are flattened before forwarding. With conversion switched off,
selected shapefile components are uploaded to S3 as a ZIP instead.

Cloudbench uploads the layer to CloudNativeGIS, waits for the import to succeed
and the PMTiles file to be ready, then downloads it and uploads it to the selected
S3 bucket. The original ZIP is not uploaded to S3. The object key keeps its prefix
and replaces `.zip` or `.shp.zip` with `.pmtiles`. The dialog reports each stage,
refreshes the S3 listing on completion, and displays conversion errors.

If the CloudNativeGIS instance requires one, its bearer token is configured
server-side via `CLOUDNATIVEGIS_API_TOKEN`. The default conversion wait timeout is 30 minutes,
configurable with `CLOUDNATIVEGIS_CONVERSION_TIMEOUT`; polling defaults to 5 seconds
via `CLOUDNATIVEGIS_POLL_INTERVAL`.

Conversion continues if the dialog is closed. Cloudbench tracks jobs in its Django
database, but the background thread does not survive a Django restart; interrupted
jobs eventually report failure and must be retried. Local temporary files are
removed after processing. The created layer remains in CloudNativeGIS for inspection.

## GeoPackage

GeoPackage files can contain:

- Multiple vector layers
- Raster tiles
- Feature attributes

All layers in the GeoPackage are published.

## GeoTIFF

GeoTIFF requirements:

- Embedded or external georeferencing
- Supported pixel types
- Optional internal tiling for performance

## Troubleshooting

### Upload Fails

1. Check file size limits
2. Verify file format is supported
3. Check GeoServer logs for errors

### Layer Not Visible

1. Verify layer is enabled
2. Check coordinate system
3. Validate bounding box
