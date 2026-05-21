import shutil
import subprocess
import zipfile
from pathlib import Path


def _cleanup(file_path: str) -> None:
    try:
        shutil.rmtree(Path(file_path).parent, ignore_errors=True)
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


def run_vector_import(cmd: list, file_path: str) -> dict:
    try:
        source = _resolve_source(file_path)
        # Replace the file_path entry in cmd with the resolved source
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
        _cleanup(file_path)


def run_raster_import(raster_cmd: list, conn_params: dict, file_path: str) -> dict:
    try:
        import psycopg2  # noqa: PLC0415

        source = _resolve_source(file_path)
        raster_cmd = [source if arg == file_path else arg for arg in raster_cmd]
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
    except zipfile.BadZipFile:
        return {"status": "failed", "error": "Invalid or corrupted zip file."}
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": "Import timed out"}
    except FileNotFoundError as e:
        return {"status": "failed", "error": f"Tool not found: {e.filename}"}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
    finally:
        _cleanup(file_path)