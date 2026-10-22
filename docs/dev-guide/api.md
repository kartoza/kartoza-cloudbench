# API Reference

CloudBench exposes a REST API under `/api/`.

## Authentication

Currently, the API supports session authentication. API tokens are planned.

## Connections

### List Connections

```http
GET /api/connections
```

Response:
```json
[
  {
    "id": "conn_123",
    "name": "Local GeoServer",
    "url": "http://localhost:8600/geoserver",
    "is_active": true
  }
]
```

### Create Connection

```http
POST /api/connections
Content-Type: application/json

{
  "name": "My GeoServer",
  "url": "http://geoserver.example.com/geoserver",
  "username": "admin",
  "password": "geoserver"
}
```

## Workspaces

### List Workspaces

```http
GET /api/workspaces/{conn_id}
```

### Create Workspace

```http
POST /api/workspaces/{conn_id}
Content-Type: application/json

{
  "name": "my_workspace"
}
```

## Layers

### List Layers

```http
GET /api/layers/{conn_id}/{workspace}
```

### Get Layer Details

```http
GET /api/layers/{conn_id}/{workspace}/{layer}
```

### Get Layer Styles

```http
GET /api/layerstyles/{conn_id}/{workspace}/{layer}
```

Response:
```json
{
  "defaultStyle": "polygon",
  "additionalStyles": ["line", "point"]
}
```

## Preview

### Start Preview Session

```http
POST /api/preview/
Content-Type: application/json

{
  "connId": "conn_123",
  "workspace": "topp",
  "layerName": "states"
}
```

Response:
```json
{
  "url": "/api/preview/abc-123"
}
```

### Get Layer Info

```http
GET /api/preview/{session_id}/api/layer
```

### Get Layer Metadata

```http
GET /api/preview/{session_id}/api/metadata
```

## Upload

### Upload to GeoServer or GeoNode

The file goes up in chunks and is passed straight on to the target, never stored
on CloudBench (see [Upload passthrough](upload-passthrough.md)).

Start (checks the connection, workspace and GeoNode's size limit first):

```http
POST /api/upload/relay
Content-Type: application/json

{
  "target": "geoserver",
  "connectionId": "conn_123",
  "workspace": "topp",
  "storeName": "roads",
  "filename": "roads.zip",
  "fileSize": 31457280,
  "chunkSize": 5242880
}
```

For GeoNode, `"target": "geonode"` with `"uploadType": "dataset" | "document"`,
and optionally `"title"` and `"abstract"`. Answers `201` with `sessionId`,
`chunkSize` and `totalChunks`; `413` when GeoNode's upload limit is smaller
than the file.

Send each chunk in order, as the raw body:

```http
PUT /api/upload/relay/{sessionId}/chunks/{index}
Content-Type: application/octet-stream

<chunk bytes>
```

Answers `{"next": n}`. A chunk sent again (its answer was lost) is acknowledged
and not sent twice. `409` when the upload failed or was cancelled, or the chunk
is ahead of `next`; `410` when the upload is no longer running.

Wait for the target's answer, or cancel:

```http
GET /api/upload/relay/{sessionId}
DELETE /api/upload/relay/{sessionId}
```

`state` is `uploading`, `processing` (all sent, waiting for the target),
`completed` (with `result`: GeoServer's store, or GeoNode's answer), `failed`
(with `error`) or `cancelled`.

### Upload straight into an S3 bucket

A plain upload, a shapefile's parts, a conversion (GeoTIFF → COG, LAS/LAZ → COPC,
GeoJSON/FlatGeobuf/KML or a shapefile → PMTiles) and a GeoPackage's inspection go up in
chunks that CloudBench passes on to the bucket as the parts of S3 multipart uploads:
nothing is stored on CloudBench (see [S3 upload passthrough](s3-upload-passthrough.md)).
Mosaics still go through `POST /api/s3/mosaic/{connId}`; `POST /api/s3/upload/{connId}`
and `/api/s3/gpkg/inspect/{connId}` still work, staging on disk.

Start (checks the size, the file type, the license and server, and whether a conversion's
layer folder exists, first):

```http
POST /api/s3/multipart/{connId}
Content-Type: application/json

{
  "filename": "dem.tif",
  "fileSize": 31457280,
  "key": "rasters/dem.tif",
  "convert": "true",
  "targetFormat": "cog",
  "license": "CC-BY-4.0"
}
```

Plus `replace`, `licenseUrl` and the on-demand server fields (`serverTypeId`,
`autoDestroy`, `instanceServerId`) as for `POST /api/s3/upload/{connId}`. A `.shp` takes
its other parts as `"companions": [{"filename": "roads.dbf", "fileSize": 70}, ...]`;
`"targetFormat": "inspect"` uploads a GeoPackage to read before converting. Answers `201`
with `sessionId`, `filename`, `chunkSize`, `totalChunks`, `key` (where the file goes) and
`companions` (each part's own session, to send its chunks to); `409` when the layer
folder exists and `replace` isn't set; `413` over `UPLOAD_MAX_FILE_SIZE`.

Send each chunk as the raw body, in any order:

```http
PUT /api/s3/multipart/{connId}/{sessionId}/parts/{index}
Content-Type: application/octet-stream

<chunk bytes>
```

Answers `{"received", "totalChunks"}`. A chunk sent again replaces its part. `400` for a
chunk of the wrong size, or a conversion's first chunk that isn't its file type; `409`
once the upload has ended; `502` when the bucket failed (worth sending again).

Then complete it, with the same fields as the start:

```http
POST /api/s3/multipart/{connId}/{sessionId}/complete
```

Completing a `.shp` completes its parts and zips them in the bucket. Answers as
`POST /api/s3/upload/{connId}` does: `201` with the `key` for a plain upload, `202` with
the `conversionJobId` for a conversion; for `inspect`, as `/api/s3/gpkg/inspect/{connId}`
does (`jobId`, `layers`, `rasterTables`, `key`), then `POST /api/s3/gpkg/convert/{jobId}`.
`400` lists missing chunks, or why a shapefile or GeoPackage can't be read.

```http
GET /api/s3/multipart/{connId}/{sessionId}
DELETE /api/s3/multipart/{connId}/{sessionId}
```

The chunks received (to resume), or abort the upload (S3 drops its parts).

### Chunked upload (PostgreSQL import)

```http
POST /api/upload/init
Content-Type: application/json

{
  "filename": "data.gpkg",
  "fileSize": 1048576,
  "chunkSize": 5242880
}
```

```http
POST /api/upload/chunk
Content-Type: multipart/form-data

sessionId: abc-123
chunkIndex: 0
chunk: <binary data>
```

Then `POST /api/pg/upload/complete` with `{"sessionId": "abc-123"}`.

## Error Responses

All errors return JSON:

```json
{
  "error": "Description of the error"
}
```

HTTP status codes:
- `400`: Bad request
- `401`: Unauthorized
- `404`: Not found
- `500`: Server error
