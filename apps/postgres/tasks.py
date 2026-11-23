import shutil
import subprocess
import zipfile
from pathlib import Path

from apps.upload.jobs import run_command


def _cleanup(file_path: str, delete_source: bool = False) -> None:
    """Remove per-call scratch state, and the uploaded source once it's done.

    A multi-layer file (e.g. a GeoPackage with several layers) is imported
    via one request per layer, all sharing the same uploaded file_path.
    The zip-extraction scratch dir is regenerated on every call so it's
    always safe to remove. The source file itself is only removed when
    delete_source is True, i.e. this is the last (or only) import request
    for this upload -- removing it earlier would break later layers.
    """
    try:
        parent = Path(file_path).parent
        if delete_source:
            shutil.rmtree(parent, ignore_errors=True)
        else:
            shutil.rmtree(parent / "extracted", ignore_errors=True)
    except Exception:
        pass


def _resolve_source(file_path: str) -> str:
    """Extract zip files and return the path ogr2ogr should use."""
    if not file_path.lower().endswith(".zip"):
        return file_path
    extract_dir = Path(file_path).parent / "extracted"
    extract_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(file_path, "r") as zf:
        zf.extractall(extract_dir)
    return str(extract_dir)


def run_vector_import(
    cmd: list,
    file_path: str,
    delete_source: bool = False,
    *,
    env: dict | None = None,
    on_progress=None,
) -> dict:
    """Run ogr2ogr (`cmd`) on the uploaded `file_path`, with no time limit.

    It runs in a background job (apps.upload.jobs), so a large file can take
    as long as it needs: `on_progress` gets ogr2ogr's percentage. The PostgreSQL password comes in `env`
    (PGPASSWORD), not in `cmd`, where any process listing would show it.
    """
    try:
        source = _resolve_source(file_path)
        # Replace the file_path entry in cmd with the resolved source
        cmd = [source if arg == file_path else arg for arg in cmd]
        returncode, stderr = run_command(cmd, env=env, on_progress=on_progress)
        if returncode == 0:
            return {"status": "completed"}
        return {"status": "failed", "error": stderr or f"ogr2ogr exited with {returncode}"}
    except zipfile.BadZipFile:
        return {"status": "failed", "error": "Invalid or corrupted zip file."}
    except FileNotFoundError:
        return {"status": "failed", "error": "ogr2ogr not found. Please install GDAL."}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
    finally:
        _cleanup(file_path, delete_source)


def _split_vacuum(sql: str) -> tuple[str, list[str]]:
    """Separate raster2pgsql's VACUUM lines from the rest of its SQL."""
    rest, vacuums = [], []
    for line in sql.splitlines():
        (vacuums if line.lstrip().upper().startswith("VACUUM") else rest).append(line)
    return "\n".join(rest), vacuums


def run_raster_import(raster_cmd: list, conn_params: dict, file_path: str) -> dict:
    try:
        import psycopg2  # noqa: PLC0415

        source = _resolve_source(file_path)
        raster_cmd = [source if arg == file_path else arg for arg in raster_cmd]
        raster_result = subprocess.run(raster_cmd, capture_output=True, text=True, timeout=3600)
        if raster_result.returncode != 0:
            return {"status": "failed", "error": raster_result.stderr}

        sql, vacuums = _split_vacuum(raster_result.stdout)
        conn = psycopg2.connect(**conn_params)
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS postgis_raster;")
                cur.execute(sql)
            conn.commit()
            # VACUUM (from raster2pgsql -M) can't run inside a transaction block.
            conn.autocommit = True
            with conn.cursor() as cur:
                for statement in vacuums:
                    cur.execute(statement)
        finally:
            conn.close()

        return {"status": "completed"}
    except zipfile.BadZipFile:
        return {"status": "failed", "error": "Invalid or corrupted zip file."}
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
