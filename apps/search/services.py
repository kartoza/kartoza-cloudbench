"""Universal search services.

Provides functionality to search across all resources
including GeoServer layers, PostgreSQL tables, S3 objects, etc.
"""

from dataclasses import dataclass
from typing import Any

from apps.core.config import get_config
from apps.geoserver.client import get_geoserver_client


@dataclass
class SearchResult:
    """Search result item."""

    type: str  # layer, table, bucket, file, connection, etc.
    name: str
    title: str
    description: str
    source: str
    source_id: str
    path: str
    metadata: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "type": self.type,
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "source": self.source,
            "sourceId": self.source_id,
            "path": self.path,
            "metadata": self.metadata or {},
        }


class SearchService:
    """Service for universal search across all resources."""

    def __init__(self, user_id: str = "default"):
        """Initialize search service."""
        self._user_id = user_id

    def search(
        self,
        query: str,
        types: list[str] | None = None,
        limit: int = 50,
    ) -> list[SearchResult]:
        """Search across all resources.

        Args:
            query: Search query
            types: Optional filter by result types
            limit: Maximum results to return

        Returns:
            List of SearchResult objects
        """
        results: list[SearchResult] = []
        query_lower = query.lower()

        # Search GeoServer connections
        if not types or "connection" in types:
            results.extend(self._search_connections(query_lower))

        # Search GeoServer layers
        if not types or "layer" in types:
            results.extend(self._search_layers(query_lower))

        # Search PostgreSQL tables
        if not types or "table" in types:
            results.extend(self._search_tables(query_lower))

        # Search S3 buckets
        if not types or "bucket" in types:
            results.extend(self._search_buckets(query_lower))

        # Sort by relevance (simple name match priority)
        results.sort(key=lambda r: (
            0 if query_lower in r.name.lower() else 1,
            r.name.lower(),
        ))

        return results[:limit]

    def _search_connections(self, query: str) -> list[SearchResult]:
        """Search GeoServer connections."""
        results = []
        config = get_config(self._user_id)

        for conn in config.list_connections():
            if query in conn.name.lower() or query in conn.url.lower():
                results.append(SearchResult(
                    type="connection",
                    name=conn.name,
                    title=conn.name,
                    description=f"GeoServer at {conn.url}",
                    source="geoserver",
                    source_id=conn.id,
                    path=f"/connections/{conn.id}",
                ))

        for conn in config.list_s3_connections():
            if query in conn.name.lower() or query in conn.endpoint.lower():
                results.append(SearchResult(
                    type="connection",
                    name=conn.name,
                    title=conn.name,
                    description=f"S3 at {conn.endpoint}",
                    source="s3",
                    source_id=conn.id,
                    path=f"/s3/{conn.id}",
                ))

        return results

    def _search_layers(self, query: str) -> list[SearchResult]:
        """Search GeoServer layers."""
        results = []
        config = get_config(self._user_id)

        for conn in config.list_connections():
            try:
                client = get_geoserver_client(conn.id, self._user_id)
                workspaces = client.list_workspaces()

                for ws in workspaces:
                    ws_name = ws.get("name")
                    if not ws_name:
                        continue

                    try:
                        layers = client.list_layers(ws_name)
                        for layer in layers:
                            layer_name = layer.get("name", "")
                            if query in layer_name.lower():
                                results.append(SearchResult(
                                    type="layer",
                                    name=layer_name,
                                    title=layer.get("title", layer_name),
                                    description=f"Layer in {ws_name}",
                                    source="geoserver",
                                    source_id=conn.id,
                                    path=f"/layers/{conn.id}/{ws_name}/{layer_name}",
                                    metadata={
                                        "workspace": ws_name,
                                        "connection": conn.name,
                                    },
                                ))
                    except Exception:
                        pass
            except Exception:
                pass

        return results

    def _search_tables(self, query: str) -> list[SearchResult]:
        """Search PostgreSQL tables."""
        results = []

        try:
            from apps.postgres.service import list_services
            from apps.postgres.schema import list_tables

            services = list_services()
            for service_name in services:
                if query in service_name.lower():
                    results.append(SearchResult(
                        type="service",
                        name=service_name,
                        title=service_name,
                        description="PostgreSQL service",
                        source="postgresql",
                        source_id=service_name,
                        path=f"/pg/{service_name}",
                    ))

                try:
                    tables = list_tables(service_name)
                    for table in tables:
                        table_name = table.get("name", "")
                        if query in table_name.lower():
                            results.append(SearchResult(
                                type="table",
                                name=table_name,
                                title=table_name,
                                description=f"Table in {service_name}",
                                source="postgresql",
                                source_id=service_name,
                                path=f"/pg/{service_name}/public/{table_name}",
                                metadata={
                                    "schema": "public",
                                    "service": service_name,
                                    "hasGeometry": table.get("geometryColumn") is not None,
                                },
                            ))
                except Exception:
                    pass
        except Exception:
            pass

        return results

    def _search_buckets(self, query: str) -> list[SearchResult]:
        """Search S3 buckets."""
        results = []
        config = get_config(self._user_id)

        for conn in config.list_s3_connections():
            try:
                from apps.s3.client import get_s3_client

                client = get_s3_client(conn.id)
                buckets = client.list_buckets()

                for bucket in buckets:
                    if query in bucket.name.lower():
                        results.append(SearchResult(
                            type="bucket",
                            name=bucket.name,
                            title=bucket.name,
                            description=f"S3 bucket on {conn.name}",
                            source="s3",
                            source_id=conn.id,
                            path=f"/s3/{conn.id}/{bucket.name}",
                            metadata={
                                "connection": conn.name,
                                "creationDate": bucket.creation_date,
                            },
                        ))
            except Exception:
                pass

        return results

    def get_suggestions(
        self,
        query: str,
        limit: int = 10,
    ) -> list[str]:
        """Get search suggestions.

        Args:
            query: Partial query
            limit: Maximum suggestions

        Returns:
            List of suggestion strings
        """
        if len(query) < 2:
            return []

        results = self.search(query, limit=limit * 2)

        # Extract unique names
        suggestions = []
        seen = set()
        for result in results:
            if result.name not in seen:
                suggestions.append(result.name)
                seen.add(result.name)
                if len(suggestions) >= limit:
                    break

        return suggestions


def get_search_service(user_id: str = "default") -> SearchService:
    """Get a search service for the given user."""
    return SearchService(user_id)
