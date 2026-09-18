"""Exposes CloudBench's own S3/GeoServer data as a real STAC catalogue.

A STAC client (or plain curl) can walk this the standard way: GET /api/stac/
for the root Catalog, /api/stac/collections for the Collection list, then
/api/stac/collections/<id>/items for that collection's Items.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from . import catalog


class StacRootView(APIView):
    """STAC landing page / root Catalog."""

    def get(self, request):
        user_id = str(request.user.id)
        return Response(catalog.build_root_catalog(request, user_id))


class StacCollectionListView(APIView):
    """All STAC Collections (one per non-empty S3 bucket / GeoServer workspace)."""

    def get(self, request):
        user_id = str(request.user.id)
        collections = [
            catalog.build_collection_json(request, user_id, summary["id"])
            for summary in catalog.list_collections(user_id)
        ]
        return Response(
            {
                "collections": collections,
                "links": [
                    {"rel": "self", "href": request.build_absolute_uri(), "type": "application/json"},
                    {"rel": "root", "href": request.build_absolute_uri("/api/stac/"), "type": "application/json"},
                ],
            }
        )


class StacCollectionDetailView(APIView):
    """A single STAC Collection."""

    def get(self, request, collection_id):
        user_id = str(request.user.id)
        result = catalog.build_collection_json(request, user_id, collection_id)
        if result is None:
            return Response({"error": "Collection not found"}, status=404)
        return Response(result)


class StacItemListView(APIView):
    """Items in a Collection, as a STAC ItemCollection (GeoJSON FeatureCollection)."""

    def get(self, request, collection_id):
        user_id = str(request.user.id)
        try:
            items = catalog.list_items(request, user_id, collection_id)
        except ValueError:
            return Response({"error": "Collection not found"}, status=404)
        if items is None:
            return Response({"error": "Collection not found"}, status=404)
        return Response(
            {
                "type": "FeatureCollection",
                "stac_version": catalog.STAC_VERSION,
                "features": items,
                "links": [
                    {"rel": "self", "href": request.build_absolute_uri(), "type": "application/json"},
                    {
                        "rel": "collection",
                        "href": request.build_absolute_uri(f"/api/stac/collections/{collection_id}"),
                        "type": "application/json",
                    },
                ],
            }
        )


class StacItemDetailView(APIView):
    """A single STAC Item."""

    def get(self, request, collection_id, item_id):
        user_id = str(request.user.id)
        try:
            item = catalog.get_item(request, user_id, collection_id, item_id)
        except ValueError:
            return Response({"error": "Collection not found"}, status=404)
        if item is None:
            return Response({"error": "Item not found"}, status=404)
        return Response(item)
