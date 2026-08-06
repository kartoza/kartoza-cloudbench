"""Views for universal search.

Provides endpoints for:
- Full text search across all resources
- Search suggestions/autocomplete
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from .services import get_search_service


class SearchView(APIView):
    """Universal search across all resources."""

    def get(self, request):
        """Search for resources.

        Query params:
        - q: Search query (required)
        - types: Comma-separated list of types to search
        - limit: Maximum results (default 50)
        """
        query = request.query_params.get("q", "")
        types_param = request.query_params.get("types")
        limit = int(request.query_params.get("limit", "50"))

        if not query:
            return Response({"results": [], "query": ""})

        types = types_param.split(",") if types_param else None

        service = get_search_service(str(request.user.id))
        results = service.search(query, types=types, limit=limit)

        return Response({
            "query": query,
            "results": [r.to_dict() for r in results],
            "count": len(results),
        })


class SearchSuggestionsView(APIView):
    """Search suggestions/autocomplete."""

    def get(self, request):
        """Get search suggestions.

        Query params:
        - q: Partial query (required)
        - limit: Maximum suggestions (default 10)
        """
        query = request.query_params.get("q", "")
        limit = int(request.query_params.get("limit", "10"))

        if not query or len(query) < 2:
            return Response({"suggestions": [], "query": query})

        service = get_search_service(str(request.user.id))
        suggestions = service.get_suggestions(query, limit=limit)

        return Response({
            "query": query,
            "suggestions": suggestions,
        })
