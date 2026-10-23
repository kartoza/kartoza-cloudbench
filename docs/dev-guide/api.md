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
