"""Views for server synchronization.

Provides endpoints for:
- Sync configuration management
- Starting sync operations
- Monitoring sync status
"""

import threading
import uuid
from datetime import datetime

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.config import SyncConfiguration, SyncOptions, get_config

from .services import SyncJobManager, get_sync_service


class SyncConfigListView(APIView):
    """List and create sync configurations."""

    def get(self, request):
        """List all sync configurations."""
        config = get_config(request.user.id)
        configs = config.config.sync_configs
        return Response({
            "configs": [
                {
                    "id": c.id,
                    "name": c.name,
                    "sourceId": c.source_id,
                    "destinationIds": c.destination_ids,
                    "options": c.options.model_dump(),
                    "createdAt": c.created_at,
                    "lastSyncedAt": c.last_synced_at,
                }
                for c in configs
            ]
        })

    def post(self, request):
        """Create a new sync configuration."""
        data = request.data

        options_data = data.get("options", {})
        options = SyncOptions(
            workspaces=options_data.get("workspaces", True),
            datastores=options_data.get("datastores", True),
            coveragestores=options_data.get("coveragestores", True),
            layers=options_data.get("layers", True),
            styles=options_data.get("styles", True),
            layergroups=options_data.get("layergroups", True),
            workspace_filter=options_data.get("workspaceFilter", []),
            datastore_strategy=options_data.get("datastoreStrategy", "skip"),
        )

        sync_config = SyncConfiguration(
            id=str(uuid.uuid4()),
            name=data.get("name", ""),
            source_id=data.get("sourceId", ""),
            destination_ids=data.get("destinationIds", []),
            options=options,
        )

        config = get_config(request.user.id)
        config.add_sync_config(sync_config)

        return Response(
            {
                "id": sync_config.id,
                "name": sync_config.name,
            },
            status=status.HTTP_201_CREATED,
        )


class SyncConfigDetailView(APIView):
    """Get, update, or delete a sync configuration."""

    def get(self, request, config_id):
        """Get sync configuration details."""
        config = get_config(request.user.id)
        sync_config = config.get_sync_config(config_id)
        if not sync_config:
            return Response(
                {"error": "Configuration not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({
            "config": {
                "id": sync_config.id,
                "name": sync_config.name,
                "sourceId": sync_config.source_id,
                "destinationIds": sync_config.destination_ids,
                "options": sync_config.options.model_dump(),
                "createdAt": sync_config.created_at,
                "lastSyncedAt": sync_config.last_synced_at,
            }
        })

    def put(self, request, config_id):
        """Update a sync configuration."""
        config = get_config(request.user.id)
        sync_config = config.get_sync_config(config_id)
        if not sync_config:
            return Response(
                {"error": "Configuration not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = request.data
        sync_config.name = data.get("name", sync_config.name)
        sync_config.source_id = data.get("sourceId", sync_config.source_id)
        sync_config.destination_ids = data.get(
            "destinationIds", sync_config.destination_ids
        )

        if "options" in data:
            options_data = data["options"]
            sync_config.options = SyncOptions(
                workspaces=options_data.get("workspaces", True),
                datastores=options_data.get("datastores", True),
                coveragestores=options_data.get("coveragestores", True),
                layers=options_data.get("layers", True),
                styles=options_data.get("styles", True),
                layergroups=options_data.get("layergroups", True),
                workspace_filter=options_data.get("workspaceFilter", []),
                datastore_strategy=options_data.get("datastoreStrategy", "skip"),
            )

        config.update_sync_config(sync_config)

        return Response({"status": "updated"})

    def delete(self, request, config_id):
        """Delete a sync configuration."""
        config = get_config(request.user.id)
        config.remove_sync_config(config_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SyncStartView(APIView):
    """Start a synchronization."""

    def post(self, request):
        """Start a sync operation.

        Expected body:
        {
            "configId": "sync-config-id"
        }
        or
        {
            "sourceId": "source-conn-id",
            "destinationIds": ["dest-conn-id"],
            "options": {...}
        }
        """
        config_id = request.data.get("configId")

        if config_id:
            # Use saved configuration
            config = get_config(request.user.id)
            sync_config = config.get_sync_config(config_id)
            if not sync_config:
                return Response(
                    {"error": "Configuration not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            # Build configuration from request
            options_data = request.data.get("options", {})
            options = SyncOptions(
                workspaces=options_data.get("workspaces", True),
                datastores=options_data.get("datastores", True),
                coveragestores=options_data.get("coveragestores", True),
                layers=options_data.get("layers", True),
                styles=options_data.get("styles", True),
                layergroups=options_data.get("layergroups", True),
                workspace_filter=options_data.get("workspaceFilter", []),
                datastore_strategy=options_data.get("datastoreStrategy", "skip"),
            )

            sync_config = SyncConfiguration(
                id="temp",
                name="Ad-hoc sync",
                source_id=request.data.get("sourceId", ""),
                destination_ids=request.data.get("destinationIds", []),
                options=options,
            )

        if not sync_config.source_id or not sync_config.destination_ids:
            return Response(
                {"error": "Source and destination IDs are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create job
        job_manager = SyncJobManager()
        job = job_manager.create_job(sync_config.id)

        # Start sync in background thread
        def run_sync():
            try:
                job_manager.update_job(job.id, status="running")
                service = get_sync_service(str(request.user.id))
                results = service.run_sync(sync_config, job.id)
                job_manager.update_job(
                    job.id,
                    status="completed",
                    progress=1.0,
                    results=results,
                )

                # Update last synced time if using saved config
                if config_id:
                    config = get_config(request.user.id)
                    cfg = config.get_sync_config(config_id)
                    if cfg:
                        cfg.last_synced_at = datetime.utcnow().isoformat()
                        config.update_sync_config(cfg)
            except Exception as e:
                job_manager.update_job(
                    job.id,
                    status="failed",
                    error=str(e),
                )

        thread = threading.Thread(target=run_sync, daemon=True)
        thread.start()

        return Response(
            {
                "jobId": job.id,
                "status": job.status,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class SyncStatusView(APIView):
    """Get sync job status."""

    def get(self, request, job_id=None):
        """Get sync status."""
        job_manager = SyncJobManager()

        if job_id:
            job = job_manager.get_job(job_id)
            if not job:
                return Response(
                    {"error": "Job not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            return Response({
                "job": {
                    "id": job.id,
                    "configId": job.config_id,
                    "status": job.status,
                    "progress": job.progress,
                    "currentStep": job.current_step,
                    "error": job.error,
                    "createdAt": job.created_at,
                    "completedAt": job.completed_at,
                    "results": job.results,
                }
            })

        # List all jobs
        jobs = job_manager.list_jobs()
        return Response({
            "jobs": [
                {
                    "id": j.id,
                    "configId": j.config_id,
                    "status": j.status,
                    "progress": j.progress,
                    "createdAt": j.created_at,
                    "completedAt": j.completed_at,
                }
                for j in jobs
            ]
        })
