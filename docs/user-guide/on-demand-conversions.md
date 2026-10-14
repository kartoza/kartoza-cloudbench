# On-demand Conversions

When you upload a file to an S3 connection, CloudBench can convert it to a
**cloud-native** format — one that a web map can read directly from the bucket,
a piece at a time, without a server in front of it. The conversion runs on
CloudNativeGIS, and in **on-demand** mode each job gets its own server, started
just for that job and deleted as soon as it finishes.

This page explains what gets converted, how to run a conversion, what it costs,
and the current limits. For where the outputs land and how to view them, see
[Layer Preview](preview.md).

## What gets converted

| You upload | You get | Good for |
| --- | --- | --- |
| GeoTIFF (`.tif`) | Cloud Optimized GeoTIFF (COG) | Rasters, DEMs, imagery |
| Several GeoTIFF tiles | One COG mosaic (+ a VRT and a STAC catalog) | A scene split into tiles |
| Vector (`.shp`/`.zip`, `.geojson`, `.gpkg`, `.kml`, …) | GeoParquet **and** PMTiles (+ a thumbnail) | Features: a table and map tiles |
| Point cloud (`.las`/`.laz`) | COPC (`.copc.laz`) | LiDAR / 3D points |

Each conversion publishes into its own folder in the bucket, registers the
layer in the bucket's catalog, and leaves a thumbnail so it previews on the map.

## Two modes

CloudBench runs conversions one of two ways, chosen by whoever configured it:

- **Fixed (non-demand)** — every job runs on one standing CloudNativeGIS
  server. Nothing is billed per job; there is no server to pick.
- **On-demand** — each job runs on a fresh server that GeoHosting starts for
  it and deletes when it is done. You pick the server size and confirm the
  cost. This is the mode used inside GeoHosting.

The rest of this page describes **on-demand**. The difference you see is the
server picker and the cost confirmation in the upload dialog.

## Running a conversion

1. Select an **S3** connection in the tree and click **Upload**.
2. Choose your file. CloudBench detects the type and shows **Convert to
   Cloud-Native** with the matching target format.
3. Pick a **server type**. The list shows each enabled size with its specs and
   price per hour; out-of-stock sizes can't be picked.
4. (Optional) Set the destination key/prefix, a licence, or — for several
   GeoTIFFs — a mosaic name.
5. Click **Upload**. A **cost confirmation** appears ("the server is billed per
   started hour and destroyed after the job"); click **Continue**.
6. Watch the job. The dialog reports each stage and refreshes the bucket
   listing when it finishes. You can close the dialog — the job keeps running.

## What happens behind the scenes

A conversion moves through these stages, and you can follow them on the job:

```
provisioning → pushing → polling → verifying → publishing → deprovisioning → completed
```

- **provisioning** — GeoHosting starts a Hetzner server for the job and waits
  for it to be healthy.
- **pushing / polling** — CloudBench hands CloudNativeGIS a link to your file
  and polls until the conversion is done.
- **verifying / publishing** — the outputs are checked and written to the
  bucket, and the layer is added to the catalog.
- **deprovisioning** — the server is deleted. This happens whether the job
  succeeded or failed, so a failed job never leaves a server running.

If a job fails, it fails cleanly: it records an error, publishes nothing
half-made, and still deletes its server.

## What it costs

Each on-demand job runs one server, billed by Hetzner **per started hour** —
so even a one-minute conversion costs a whole hour of the size you picked. The
price you see in the picker is Hetzner's price plus a margin set on GeoHosting.
The server is deleted as soon as the job ends, so you pay for one job's worth,
not an idle machine.

Tips to keep cost down:

- Pick the smallest size that fits the job.
- Batch tiles into one mosaic upload instead of many single COGs.
- Remember that a cancelled or failed job still used a started hour.

## Cancelling

You can cancel a job while it is still pending, pushing, or polling (not once
it is verifying or publishing). It stops at its next step, deletes its server,
and is marked cancelled. A GeoPackage's paired jobs are cancelled together.

## Current limits

- **GeoPackage conversion is not available in on-demand mode.** A GeoPackage
  is meant to convert as two jobs (its vector layers → PMTiles, its raster
  tables → COG) chosen in a picker after the file is *inspected*. Inspection
  has no server to run on in on-demand mode, so the upload reports an error
  ("Pick a server to run the conversion on", or a 502 from the inspect step).
  Use the fixed mode for GeoPackages, or convert their layers separately.
- **Point-cloud (COPC) preview needs bucket CORS.** The conversion works and
  the `.copc.laz` lands in the bucket, but previewing it reads the file from
  the bucket's own origin in a background worker. Unless the bucket sends CORS
  headers, that preview stays blank. The file itself is fine to download and
  open elsewhere.
- **One server per job.** A GeoPackage's two jobs (in fixed mode) use one
  server each, run one after the other, not a shared server.

## Configuration

On-demand mode and its limits are set by an administrator. The relevant
settings — `CLOUDNATIVEGIS_ON_DEMAND`, the GeoHosting OAuth client, and the
conversion timeouts — are documented under
[Environment Variables](../admin-guide/environment.md). The pipeline itself is
described in [Architecture](../dev-guide/architecture.md).
