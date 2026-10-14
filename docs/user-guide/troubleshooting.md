# Troubleshooting

Common symptoms and what to check. Page-specific troubleshooting also lives in
[File Uploads](uploads.md) and [Layer Preview](preview.md).

## Sign-in and sessions

- **Signed out during the day (inside GeoHosting).** The token that signs you
  in automatically lasts the working day. When it expires, the page returns to
  the login screen; reopen CloudBench from GeoHosting to get a fresh one.
- **"Unknown error" loading the dashboard.** Usually the sign-in token is
  missing or stale — reload the page, or reopen CloudBench from GeoHosting.

## Connections

- **A connection won't save.** It failed its test. See
  [Connections → When a connection fails](connections.md#when-a-connection-fails).
- **S3 signature errors.** The endpoint or region is usually wrong for the
  provider; confirm both match the bucket.

## Uploads and conversions

- **Upload fails or stalls.** Check the file size limit (GeoNode has its own),
  that the format is supported, and the target service's logs. "No data came
  for 60 seconds" means the connection dropped — upload again.
- **Shapefile rejected.** Select the `.shp`, `.shx`, and `.dbf` together (add
  `.prj` for the projection), or upload a ZIP with exactly one shapefile. A
  lone `.shp` is not enough.
- **"Pick a server to run the conversion on."** An on-demand conversion needs
  a server size selected in the upload dialog. Pick one, then upload.
- **No server sizes to pick, or all out of stock.** The enabled sizes are out
  of stock at the provider; try again later or ask an administrator to enable
  another size.
- **GeoPackage conversion errors in on-demand mode.** This is a known limit —
  GeoPackage inspection isn't available on demand. See
  [On-demand Conversions → Current limits](on-demand-conversions.md#current-limits).

## Preview

- **Blank map, no layer.** Reopen the preview. If a raster never appears, its
  extent may be unreadable; try downloading and checking the file in a GIS.
- **"Failed to fetch" / "Request failed" on a preview or README.** The viewer
  couldn't read the file from the bucket. Recent CloudBench reads these through
  its own proxy to avoid this; if you still see it, make sure you are on the
  current build.
- **Point cloud (COPC) preview is blank.** Previewing a `.copc.laz` reads it
  from the bucket's own origin in a background worker, which needs CORS headers
  on the bucket. Until those are set, the preview stays blank — the file itself
  is fine to download and open elsewhere. See
  [On-demand Conversions → Current limits](on-demand-conversions.md#current-limits).
- **Layer in the wrong place.** Check its coordinate system and bounding box.

## Still stuck?

Collect the exact message, what you clicked, and the file or connection
involved, and check the service's own logs (GeoServer, GeoNode, the database).
For reporting issues, see [Contributing](../dev-guide/contributing.md).
