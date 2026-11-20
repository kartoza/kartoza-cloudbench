import shutil
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

_ZIP_MEMBER_EXTENSIONS = (".gpkg", ".geojson", ".json", ".kml", ".fgb", ".csv")


def _cleanup(file_path: str, delete_source: bool = False) -> None:
    """Remove the uploaded source once it's done.

    A multi-layer file (e.g. a GeoPackage with several layers) is imported
    via one request per layer, all sharing the same uploaded file_path, so
    the source is only removed when delete_source is True, i.e. on the last
    (or only) import request for this upload.
    """
    try:
        if delete_source:
            shutil.rmtree(Path(file_path).parent, ignore_errors=True)
    except Exception:
        pass


def ogr_source_path(file_path: str) -> str:
    """Return the GDAL dataset path for an upload, reading zips in place via /vsizip/."""
    if not file_path.lower().endswith(".zip"):
        return file_path

    zip_root = f"/vsizip/{Path(file_path).resolve()}"
    with zipfile.ZipFile(file_path) as zf:
        names = zf.namelist()
    names = [
        n
        for n in names
        if not n.startswith("__MACOSX/") and not PurePosixPath(n).name.startswith("._")
    ]

    shp_dirs = {str(PurePosixPath(n).parent) for n in names if n.lower().endswith(".shp")}
    if len(shp_dirs) == 1:
        folder = shp_dirs.pop()
        # GDAL's /vsizip/ root only opens shapefiles at the top level.
        return zip_root if folder == "." else f"{zip_root}/{folder}"
    if len(shp_dirs) > 1:
        raise ValueError(
            "The zip has shapefiles in more than one folder; put them in a single folder and upload again."
        )

    members = [n for n in names if n.lower().endswith(_ZIP_MEMBER_EXTENSIONS)]
    if len(members) == 1:
        return f"{zip_root}/{members[0]}"
    return zip_root


def run_vector_import(cmd: list, file_path: str, delete_source: bool = False) -> dict:
    try:
        source = ogr_source_path(file_path)
        cmd = [source if arg == file_path else arg for arg in cmd]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            return {"status": "completed"}
        return {"status": "failed", "error": result.stderr}
    except zipfile.BadZipFile:
        return {"status": "failed", "error": "Invalid or corrupted zip file."}
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Import timed out after 10 minutes"}
    except FileNotFoundError:
        return {"status": "failed", "error": "ogr2ogr not found. Please install GDAL."}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
    finally:
        _cleanup(file_path, delete_source)


def run_raster_import(raster_cmd: list, conn_params: dict, file_path: str) -> dict:
    try:
        import psycopg2  # noqa: PLC0415

        raster_result = subprocess.run(raster_cmd, capture_output=True, text=True, timeout=600)
        if raster_result.returncode != 0:
            return {"status": "failed", "error": raster_result.stderr}

        conn = psycopg2.connect(**conn_params)
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS postgis_raster;")
                cur.execute(raster_result.stdout)
            conn.commit()
        finally:
            conn.close()

        return {"status": "completed"}
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Import timed out"}
    except FileNotFoundError as e:
        return {"status": "failed", "error": f"Tool not found: {e.filename}"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
    finally:
        # A raster import is always a single request for its file, so the
        # source can be removed unconditionally once this call is done.
        _cleanup(file_path, delete_source=True)
