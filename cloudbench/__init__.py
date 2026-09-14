"""Kartoza CloudBench - Unified management for GeoServer and PostgreSQL/PostGIS."""

__version__ = "0.3.0"

from .celery import app as celery_app

__all__ = ["celery_app"]
