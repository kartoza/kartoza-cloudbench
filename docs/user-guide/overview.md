# Overview & Workflow

CloudBench is a workbench for geospatial data. From one web interface you
connect to the services that hold your data — GeoServer, PostgreSQL/PostGIS,
GeoNode, and S3 object storage — then browse, upload, convert, and preview
layers without leaving the page.

This page is the map of how CloudBench fits together and the path a typical
task follows. For installing or deploying it, see
[Getting Started](../getting-started/installation.md); for each screen in
detail, see the rest of the User Guide.

## Where CloudBench runs

CloudBench runs in two places, and both use the same interface:

- **Standalone** — you open the web UI directly (see
  [Quick Start](../getting-started/quickstart.md)) and sign in.
- **Inside GeoHosting** — you open GeoHosting and click **CloudBench**. It
  loads in a panel and signs you in automatically with a token that lasts the
  working day. This is where on-demand conversions (below) are available,
  because GeoHosting supplies the servers they run on.

## The four connection types

Everything in CloudBench hangs off a **connection** — a saved pointer to one
service, shown in the tree on the left. Each type does a different job:

| Connection | What it manages | Typical use |
| --- | --- | --- |
| **GeoServer** | Workspaces, stores, layers, styles, tile caches | Publish and style layers, seed tiles |
| **PostgreSQL/PostGIS** | Database services and their tables | Import vector data into a spatial database |
| **GeoNode** | A GeoNode site's datasets | Upload datasets with titles and metadata |
| **S3 storage** | One bucket of cloud-native files | Store and convert COG, PMTiles, GeoParquet, COPC |

A connection is scoped to exactly one target — one GeoServer, one database,
one bucket — so you can add several of the same type and switch between them.

## The general workflow

Most work in CloudBench follows the same five steps:

1. **Add a connection.** Click the **+** next to a connection type and fill in
   the service's URL and credentials. CloudBench tests it before saving. In
   GeoHosting, the connections for your instances are usually added already.
2. **Browse.** Expand the connection in the tree to see what it holds —
   workspaces and layers, database tables, bucket folders and objects.
3. **Upload or import.** Use the **Upload** button to send a file to the
   target. For S3, you can also **convert** the file to a cloud-native format
   in the same step (see [On-demand Conversions](on-demand-conversions.md)).
4. **Preview.** Click a layer or object to open it on a map, in a 3D view, or
   as a table (see [Layer Preview](preview.md)).
5. **Use and share.** Style it in GeoServer, serve it as tiles, or hand the
   bucket folder to another tool — the converted outputs are standard files.

```
  Add a          Browse the         Upload / convert        Preview        Use / share
  connection  →  tree          →    (GeoServer, PostGIS  →  on a map  →    (styles, tiles,
                                     GeoNode, or S3)         or table       catalog, download)
```

## What makes CloudBench's S3 different

For the other three connection types, CloudBench is a management front end for
an existing service. S3 is more: besides browsing and uploading, it can
**convert** your data into cloud-native formats that stream straight from the
bucket — Cloud Optimized GeoTIFF (COG), PMTiles, GeoParquet, and COPC point
clouds — and preview them on the map. That conversion is what
[On-demand Conversions](on-demand-conversions.md) covers.

## Where to go next

- [Web UI](web-ui.md) — the tree, panels, and controls in detail.
- [File Uploads](uploads.md) — what each target accepts and how upload works.
- [On-demand Conversions](on-demand-conversions.md) — converting S3 data to
  cloud-native formats on a server spun up for the job.
- [Layer Preview](preview.md) — maps, 3D, tables, and styles.
- [TUI](tui.md) — the terminal interface, for the same connections from a shell.
