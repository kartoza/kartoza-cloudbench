"""Views for AI query generation.

Provides endpoints for:
- Generating SQL from natural language
- Explaining SQL queries
- Executing AI-generated queries
- Listing available LLM providers
"""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.postgres.schema import execute_query

from .engine import AIQueryEngine, get_available_providers, get_schema_context


class AIProvidersView(APIView):
    """List available LLM providers."""

    def get(self, _request):
        """List all available providers."""
        providers = get_available_providers()
        return Response({
            "providers": [
                {
                    "name": p.name,
                    "type": p.type,
                    "url": p.url,
                    "model": p.model,
                    "available": p.available,
                }
                for p in providers
            ]
        })


class AIQueryView(APIView):
    """Generate SQL from natural language."""

    def post(self, request):
        """Generate SQL from a question.

        Expected body:
        {
            "question": "Show me all buildings within 100m of parks",
            "serviceName": "mydb",
            "schema": "public",
            "model": "llama3.2",
            "url": "http://localhost:11434"
        }
        """
        question = request.data.get("question")
        service_name = request.data.get("serviceName")
        schema = request.data.get("schema", "public")
        model = request.data.get("model", "llama3.2")
        url = request.data.get("url", "http://localhost:11434")

        if not question:
            return Response(
                {"error": "Question is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not service_name:
            return Response(
                {"error": "Service name is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Get schema context
            schema_context = get_schema_context(service_name, schema)

            # Generate SQL
            engine = AIQueryEngine(ollama_url=url, model=model)
            result = engine.generate_sql(question, schema_context)

            return Response({
                "sql": result.sql,
                "explanation": result.explanation,
                "confidence": result.confidence,
                "warnings": result.warnings,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class AIExplainView(APIView):
    """Explain a SQL query."""

    def post(self, request):
        """Explain a SQL query in plain English.

        Expected body:
        {
            "sql": "SELECT * FROM buildings WHERE ...",
            "model": "llama3.2",
            "url": "http://localhost:11434"
        }
        """
        sql = request.data.get("sql")
        model = request.data.get("model", "llama3.2")
        url = request.data.get("url", "http://localhost:11434")

        if not sql:
            return Response(
                {"error": "SQL is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            engine = AIQueryEngine(ollama_url=url, model=model)
            explanation = engine.explain_query(sql)

            return Response({
                "explanation": explanation,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class AIExecuteView(APIView):
    """Execute an AI-generated query."""

    def post(self, request):
        """Execute a SQL query.

        Expected body:
        {
            "sql": "SELECT * FROM buildings LIMIT 10",
            "serviceName": "mydb",
            "limit": 1000
        }
        """
        sql = request.data.get("sql")
        service_name = request.data.get("serviceName")
        limit = request.data.get("limit", 1000)

        if not sql:
            return Response(
                {"error": "SQL is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not service_name:
            return Response(
                {"error": "Service name is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Safety check - only allow SELECT queries
        sql_upper = sql.upper().strip()
        if not sql_upper.startswith("SELECT"):
            return Response(
                {"error": "Only SELECT queries are allowed through this endpoint"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = execute_query(service_name, sql, limit=limit)
            return Response(result)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class AISuggestView(APIView):
    """Suggest query improvements or alternatives."""

    def post(self, request):
        """Suggest improvements for a query.

        Expected body:
        {
            "sql": "SELECT * FROM buildings",
            "serviceName": "mydb",
            "model": "llama3.2",
            "url": "http://localhost:11434"
        }
        """
        sql = request.data.get("sql")
        service_name = request.data.get("serviceName")
        model = request.data.get("model", "llama3.2")
        url = request.data.get("url", "http://localhost:11434")

        if not sql or not service_name:
            return Response(
                {"error": "SQL and serviceName are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from .engine import OllamaClient

            client = OllamaClient(url=url, model=model)

            prompt = f"""Analyze this SQL query and suggest improvements:

Query:
{sql}

Consider:
1. Performance optimizations (indexes, query structure)
2. Spatial operation efficiency (for PostGIS queries)
3. Missing WHERE clauses or LIMIT
4. Better ways to achieve the same result

Provide 2-3 specific, actionable suggestions."""

            suggestions = client.generate(
                prompt=prompt,
                temperature=0.3,
            ).strip()

            return Response({
                "suggestions": suggestions,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class AISchemaContextView(APIView):
    """Get schema context for AI queries."""

    def get(self, request, service_name):
        """Get schema context for a service."""
        schema = request.query_params.get("schema", "public")

        try:
            context = get_schema_context(service_name, schema)
            return Response({
                "context": context,
                "serviceName": service_name,
                "schema": schema,
            })
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
