import contextlib
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.contrib.auth.models import User


def _cleanup(file_path: str) -> None:
    with contextlib.suppress(Exception):
        shutil.rmtree(Path(file_path).parent, ignore_errors=True)


def run_geoserver_upload(
    conn_id: str,
    user: "User",
    workspace: str,
    store_name: str,
    file_path: str,
) -> dict:
    try:
        from apps.geoserver.client import get_geoserver_client  # noqa: PLC0415

        client = get_geoserver_client(conn_id, user)

        with open(file_path, "rb") as f:
            data = f.read()

        name_lower = Path(file_path).name.lower()
        if name_lower.endswith(".zip") or name_lower.endswith(".shp"):
            client.upload_shapefile(workspace, store_name, data)
            store_type = "shapefile"
        elif name_lower.endswith(".tif") or name_lower.endswith(".tiff"):
            client.upload_geotiff(workspace, store_name, data)
            store_type = "geotiff"
        elif name_lower.endswith(".gpkg"):
            client.upload_geopackage(workspace, store_name, data)
            store_type = "geopackage"
        else:
            return {"status": "failed", "error": f"Unsupported file type: {Path(file_path).name}"}

        return {"status": "completed", "storeName": store_name, "storeType": store_type}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
    finally:
        _cleanup(file_path)
