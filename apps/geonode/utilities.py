"""Utilities for GeoNode app."""

# GeoNode API uses "geoapps" as the endpoint for geostories
RESOURCE_TYPE_LIST_REQUEST_MAP = {
    "datasets": "dataset",
    "maps": "map",
    "documents": "document",
    "dashboards": "dashboard",
    "geostories": "geostory",
}

RESOURCE_TYPE_DETAIL_REQUEST_MAP = {
    "dashboards": "resource",
    "geostories": "resource",
}