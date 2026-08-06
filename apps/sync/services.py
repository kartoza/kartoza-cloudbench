"""Server synchronization services.

Provides functionality to synchronize GeoServer resources
between multiple servers.
"""

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from apps.core.config import SyncConfiguration, SyncOptions, get_config
from apps.geoserver.client import get_geoserver_client


@dataclass
class SyncJob:
    """Sync job tracking."""

    id: str
    config_id: str
    status: str  # pending, running, completed, failed
    progress: float = 0.0
    current_step: str = ""
    error: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: str = ""
    results: dict[str, Any] = field(default_factory=dict)


class SyncJobManager:
    """Manager for sync jobs."""

    _instance: "SyncJobManager | None" = None
    _lock = threading.RLock()

    def __new__(cls) -> "SyncJobManager":
        """Ensure singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._jobs: dict[str, SyncJob] = {}
        return cls._instance

    def create_job(self, config_id: str) -> SyncJob:
        """Create a new sync job."""
        with self._lock:
            job = SyncJob(
                id=str(uuid.uuid4()),
                config_id=config_id,
                status="pending",
            )
            self._jobs[job.id] = job
            return job

    def get_job(self, job_id: str) -> SyncJob | None:
        """Get a job by ID."""
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[SyncJob]:
        """List all jobs."""
        return list(self._jobs.values())

    def update_job(
        self,
        job_id: str,
        status: str | None = None,
        progress: float | None = None,
        current_step: str | None = None,
        error: str | None = None,
        results: dict[str, Any] | None = None,
    ) -> None:
        """Update job status."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                if status:
                    job.status = status
                    if status in ("completed", "failed"):
                        job.completed_at = datetime.utcnow().isoformat()
                if progress is not None:
                    job.progress = progress
                if current_step:
                    job.current_step = current_step
                if error:
                    job.error = error
                if results:
                    job.results.update(results)


class SyncService:
    """Service for synchronizing GeoServer resources."""

    def __init__(self, user_id: str = "default"):
        """Initialize sync service."""
        self._user_id = user_id
        self.job_manager = SyncJobManager()

    def sync_workspaces(
        self,
        source_id: str,
        dest_id: str,
        options: SyncOptions,
    ) -> dict[str, Any]:
        """Sync workspaces from source to destination.

        Args:
            source_id: Source connection ID
            dest_id: Destination connection ID
            options: Sync options

        Returns:
            Sync results
        """
        source = get_geoserver_client(source_id, self._user_id)
        dest = get_geoserver_client(dest_id, self._user_id)

        results = {
            "workspaces": {"created": 0, "skipped": 0, "errors": []},
        }

        # Get source workspaces
        source_workspaces = source.list_workspaces()

        # Filter if specified
        if options.workspace_filter:
            source_workspaces = [
                ws for ws in source_workspaces
                if ws.get("name") in options.workspace_filter
            ]

        # Get destination workspaces
        dest_workspaces = {ws.get("name") for ws in dest.list_workspaces()}

        for ws in source_workspaces:
            ws_name = ws.get("name")
            if not ws_name:
                continue

            if ws_name in dest_workspaces:
                results["workspaces"]["skipped"] += 1
                continue

            try:
                dest.create_workspace(ws_name)
                results["workspaces"]["created"] += 1
            except Exception as e:
                results["workspaces"]["errors"].append({
                    "workspace": ws_name,
                    "error": str(e),
                })

        return results

    def sync_styles(
        self,
        source_id: str,
        dest_id: str,
        workspace: str | None = None,
    ) -> dict[str, Any]:
        """Sync styles from source to destination.

        Args:
            source_id: Source connection ID
            dest_id: Destination connection ID
            workspace: Optional workspace to sync

        Returns:
            Sync results
        """
        source = get_geoserver_client(source_id, self._user_id)
        dest = get_geoserver_client(dest_id, self._user_id)

        results = {
            "styles": {"created": 0, "updated": 0, "skipped": 0, "errors": []},
        }

        # Get source styles
        source_styles = source.list_styles(workspace)

        # Get destination styles
        dest_styles = {s.get("name") for s in dest.list_styles(workspace)}

        for style in source_styles:
            style_name = style.get("name")
            if not style_name:
                continue

            try:
                # Get style content
                style_content = source.get_style(style_name, workspace)

                if style_name in dest_styles:
                    # Update existing
                    dest.update_style(style_name, style_content, workspace)
                    results["styles"]["updated"] += 1
                else:
                    # Create new
                    dest.create_style(style_name, style_content, workspace)
                    results["styles"]["created"] += 1
            except Exception as e:
                results["styles"]["errors"].append({
                    "style": style_name,
                    "error": str(e),
                })

        return results

    def run_sync(
        self,
        config: SyncConfiguration,
        job_id: str,
    ) -> dict[str, Any]:
        """Run a full synchronization based on config.

        Args:
            config: Sync configuration
            job_id: Job ID for tracking

        Returns:
            Complete sync results
        """
        results = {
            "sourceId": config.source_id,
            "destinationIds": config.destination_ids,
            "results": {},
        }

        total_steps = len(config.destination_ids) * 5  # 5 resource types
        current_step = 0

        for dest_id in config.destination_ids:
            dest_results = {}

            # Sync workspaces
            if config.options.workspaces:
                self.job_manager.update_job(
                    job_id,
                    current_step="Syncing workspaces",
                    progress=current_step / total_steps,
                )
                dest_results["workspaces"] = self.sync_workspaces(
                    config.source_id, dest_id, config.options
                )
            current_step += 1

            # Sync styles
            if config.options.styles:
                self.job_manager.update_job(
                    job_id,
                    current_step="Syncing styles",
                    progress=current_step / total_steps,
                )
                dest_results["styles"] = self.sync_styles(
                    config.source_id, dest_id
                )
            current_step += 1

            # Other sync operations would go here...
            current_step += 3  # Skip remaining steps for now

            results["results"][dest_id] = dest_results

        return results


def get_sync_service(user_id: str = "default") -> SyncService:
    """Get a sync service for the given user."""
    return SyncService(user_id)
