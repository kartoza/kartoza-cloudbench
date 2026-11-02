# Connection permissions

**Branch:** `feat/connection-permission-check`, on top of `feat/s3-upload-passthrough`.

## Why

A connection test used to check only that CloudBench could log in. A read-only S3 key, a
GeoServer user who isn't an administrator, a GeoNode user who may not add resources or a
database user who can't create tables all passed. They then failed halfway through an upload,
after the file was sent, with an error from the server.

Now CloudBench checks that the credentials may do **what its code does** with them:

- **When a connection is tested, added or edited:**
  - the test shows each permission, with what it's needed for;
  - a connection missing a required one is **refused**, saying which;
  - editing only the name doesn't re-test.
- **When an upload or import starts:**
  - the permissions that action needs are checked again, since a policy can change after the
    connection was saved;
  - it's refused **before anything is sent** (403), saying which.

Shared code: `apps/core/permissions.py` (`Permission`, `missing`, `refusal`). In the dialogs,
`PermissionList` shows them.

## How they're checked: nothing is left behind

There's no "dry run" in these APIs, so each check makes a request the server refuses for want
of permission (401/403), or else for another reason that changes nothing.

### S3 (`S3Client.check_permissions`)

| Permission | Needed for | How it's checked |
|---|---|---|
| list | browsing the bucket | `ListObjectsV2`, 1 key |
| read | previews, downloads, conversions | `HeadObject` on a key that isn't there: 404 if allowed, 403 if not |
| write | uploads, conversions | a multipart upload of 1 byte (`CreateMultipartUpload`, `UploadPart`, `ListParts`), then aborted: no object is ever made |
| abort uploads | cancelling an upload | the abort above |
| delete | deleting files, replacing layers | `DeleteObject` on a key that isn't there: 204 if allowed, 403 if not |

The keys are under `.cloudbench-permission-check/` at the bucket root.

- **Leftovers:** a key that may write but not abort leaves its 1-byte upload open (not an
  object). That key is refused anyway, since cancelling an upload needs the same permission.
- **When an upload starts:** a plain upload needs write and abort. Every other upload (a
  conversion, shapefile, GeoPackage or mosaic) also needs read and delete in the bucket:
  - GDAL and CloudNativeGIS read the file there;
  - CloudBench deletes temporary parts, replaced layers and refused files there.
- **Refused mid-upload:** a 403 from the bucket during an upload is answered as 403 ("The
  bucket refused this connection's key"), not 502.

### GeoServer (`GeoServerClient.check_permissions`)

| Permission | Needed for | How it's checked |
|---|---|---|
| read | browsing workspaces, stores and layers | `GET /rest/workspaces.json` |
| write | uploads, and changing workspaces, stores, layers and styles | `DELETE` of a workspace that isn't there: 404 if allowed, 401/403 if not |

GeoServer checks REST permissions (`rest.properties`, or a workspace administrator's rights)
before it handles a request.

- **A user who isn't an administrator:** by default the REST API is for administrators only,
  so the first request of a test (`/rest/about/version.json`) already answers 403. The test
  then runs the checks, so the refusal still says which permissions are lacking.

- **When an upload starts:** the write check is a `DELETE` of a store that isn't there, in the
  upload's workspace.
- **The tree's reachability check** (`GET /api/connections/<id>/test`) doesn't check
  permissions, so a saved connection doesn't show as unreachable for them.

### GeoNode (`GeoNodeClient.check_permissions`)

| Permission | Needed for | How it's checked |
|---|---|---|
| read | browsing resources | `GET /api/v2/resources` |
| upload datasets | uploading datasets | `POST /api/v2/uploads/upload` with a 1-byte "zip" |
| upload documents | uploading documents | `POST /api/v2/documents/` without a file |

GeoNode checks the user's permission first: `base.add_resourcebase`, and refuses everyone when
it's read-only. So a user who may not upload gets a 403; one who may gets an error about the
file, and nothing is created (the 1-byte "zip" answers 500 "No handlers found for this dataset
type": it's refused before any import starts).

- **API keys:** this works with an API key too, where the username isn't known, so a user's
  `perms` can't be looked up.
- **When an upload starts:** the check for that kind of upload (dataset or document).

### PostGIS (`PGServiceClient.check_permissions`)

Read from the catalogue in one query; nothing is created.

| Permission | Needed for | How it's checked | Required |
|---|---|---|---|
| PostGIS | spatial imports | the `postgis` extension is installed | yes |
| create tables | imports | `has_schema_privilege(…, 'CREATE')` on some schema (lists them) | yes |
| import rasters | raster imports | a `raster` type exists, or the user is a superuser (`CREATE EXTENSION postgis_raster`) | no: reported, and checked when a raster is imported |

- **Connections were saved untested:** now they're tested on create, and on edit when a field
  that connects changes.
- **When an import starts:** `CREATE` on its target schema (a raster: also raster import).
- **Why raster import isn't required:** many hosted databases have no `postgis_raster` and give
  no superuser, while vector imports work there.

## Verified

| Target | Against | Result |
|---|---|---|
| S3 | MinIO with three policies: full, read-only, no delete (and write-only for the probe) | each told apart; bucket left with 0 objects and 0 open uploads |
| S3 | DigitalOcean Spaces (GeoHosting's bucket, under `zakki/`) | all allowed; nothing left |
| PostGIS | `kartoza/postgis` 16 with a read-only role, a role with `CREATE` on one schema, and a superuser | refused / allowed (imports into `public` refused) / allowed with rasters |
| GeoServer | GeoHosting staging GeoServer: the admin, and a user with no role | admin allowed (`DELETE` answers 404); the user refused for read and write (403); a wrong password still says so |
| GeoNode | GeoHosting staging GeoNode: the admin, and a user taken out of every group (`perms: []`) | admin allowed; the user refused for both uploads (403); 0 resources and 0 execution requests left |

The automated tests cover each check's outcomes, the refusals on save and on upload/import,
and the dialogs' permission list.
