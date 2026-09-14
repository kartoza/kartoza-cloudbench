"""AI query engine with Ollama integration.

Provides natural language to SQL query generation and explanation
using local LLM models via Ollama.
"""

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class LLMProvider:
    """LLM provider configuration."""

    name: str
    type: str  # "ollama", "openai", "anthropic"
    url: str
    model: str
    available: bool = False


@dataclass
class QueryResult:
    """AI query generation result."""

    sql: str
    explanation: str
    confidence: float
    warnings: list[str]


class OllamaClient:
    """Client for Ollama API."""

    def __init__(
        self,
        url: str = "http://localhost:11434",
        model: str = "llama3.2",
    ):
        """Initialize Ollama client.

        Args:
            url: Ollama API URL
            model: Model name to use
        """
        self.url = url.rstrip("/")
        self.model = model
        self.client = httpx.Client(timeout=120.0)

    def is_available(self) -> bool:
        """Check if Ollama is available.

        Returns:
            True if Ollama is running and accessible
        """
        try:
            response = self.client.get(f"{self.url}/api/tags")
            return response.status_code == 200
        except Exception:
            return False

    def list_models(self) -> list[dict[str, Any]]:
        """List available models.

        Returns:
            List of model information dictionaries
        """
        try:
            response = self.client.get(f"{self.url}/api/tags")
            response.raise_for_status()
            return response.json().get("models", [])
        except Exception:
            return []

    def generate(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> str:
        """Generate text from a prompt.

        Args:
            prompt: User prompt
            system: System prompt
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        if system:
            payload["system"] = system

        response = self.client.post(
            f"{self.url}/api/generate",
            json=payload,
        )
        response.raise_for_status()

        return response.json().get("response", "")

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> str:
        """Chat with the model.

        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Assistant's response
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        response = self.client.post(
            f"{self.url}/api/chat",
            json=payload,
        )
        response.raise_for_status()

        return response.json().get("message", {}).get("content", "")


class AIQueryEngine:
    """Engine for generating SQL from natural language."""

    SQL_SYSTEM_PROMPT = """You are a PostgreSQL/PostGIS SQL expert. Your task is to convert natural language questions about geospatial data into valid SQL queries.

Guidelines:
1. Always use proper PostGIS functions for spatial operations (ST_Contains, ST_Intersects, ST_Distance, ST_Area, ST_Buffer, etc.)
2. Use proper quoting for identifiers with double quotes
3. Use parameterized style for values where appropriate
4. Include appropriate JOINs when relating tables
5. Add ORDER BY and LIMIT clauses when appropriate
6. Handle geometry columns properly (usually named 'geom' or 'geometry')
7. For distance calculations, consider using ST_Transform to a projected CRS
8. Always return only the SQL query, nothing else

Available tables and columns will be provided in the context."""

    EXPLAIN_SYSTEM_PROMPT = """You are a PostgreSQL/PostGIS SQL expert. Your task is to explain SQL queries in plain English, focusing on:

1. What data the query retrieves or modifies
2. Any spatial operations being performed
3. How tables are joined
4. What conditions filter the data
5. Any potential performance considerations

Be concise but thorough."""

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        model: str = "llama3.2",
    ):
        """Initialize the AI query engine.

        Args:
            ollama_url: Ollama API URL
            model: Model name to use
        """
        self.client = OllamaClient(url=ollama_url, model=model)

    def generate_sql(
        self,
        question: str,
        schema_context: str,
        examples: list[dict[str, str]] | None = None,
    ) -> QueryResult:
        """Generate SQL from a natural language question.

        Args:
            question: Natural language question
            schema_context: Database schema information
            examples: Optional list of example question/SQL pairs

        Returns:
            QueryResult with generated SQL
        """
        # Build the prompt
        prompt_parts = [
            f"Database Schema:\n{schema_context}\n",
        ]

        if examples:
            prompt_parts.append("Examples:")
            for ex in examples:
                prompt_parts.append(f"Q: {ex['question']}")
                prompt_parts.append(f"SQL: {ex['sql']}\n")

        prompt_parts.append(f"Question: {question}")
        prompt_parts.append("SQL:")

        prompt = "\n".join(prompt_parts)

        # Generate SQL
        sql = self.client.generate(
            prompt=prompt,
            system=self.SQL_SYSTEM_PROMPT,
            temperature=0.1,
        ).strip()

        # Clean up the response
        sql = self._clean_sql(sql)

        # Generate explanation
        explanation = self._explain_query(sql)

        # Check for potential issues
        warnings = self._analyze_query(sql)

        return QueryResult(
            sql=sql,
            explanation=explanation,
            confidence=0.8,  # Placeholder - could be based on model confidence
            warnings=warnings,
        )

    def explain_query(self, sql: str) -> str:
        """Explain a SQL query in plain English.

        Args:
            sql: SQL query to explain

        Returns:
            Plain English explanation
        """
        prompt = f"Explain this SQL query:\n\n{sql}"

        return self.client.generate(
            prompt=prompt,
            system=self.EXPLAIN_SYSTEM_PROMPT,
            temperature=0.3,
        ).strip()

    def _explain_query(self, sql: str) -> str:
        """Generate a brief explanation of the query."""
        try:
            return self.explain_query(sql)
        except Exception:
            return "Unable to generate explanation."

    def _clean_sql(self, sql: str) -> str:
        """Clean up generated SQL."""
        # Remove markdown code blocks if present
        if sql.startswith("```"):
            lines = sql.split("\n")
            # Remove first and last lines if they're code fence markers
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            sql = "\n".join(lines)

        # Remove leading/trailing whitespace
        sql = sql.strip()

        # Ensure it ends with semicolon
        if not sql.endswith(";"):
            sql += ";"

        return sql

    def _analyze_query(self, sql: str) -> list[str]:
        """Analyze query for potential issues."""
        warnings = []

        sql_upper = sql.upper()

        # Check for potentially dangerous operations
        if "DROP" in sql_upper:
            warnings.append("Query contains DROP statement - use with caution")
        if "DELETE" in sql_upper:
            warnings.append("Query contains DELETE statement - use with caution")
        if "UPDATE" in sql_upper:
            warnings.append("Query contains UPDATE statement - use with caution")
        if "TRUNCATE" in sql_upper:
            warnings.append("Query contains TRUNCATE statement - use with caution")

        # Check for missing LIMIT on SELECT
        if sql_upper.startswith("SELECT") and "LIMIT" not in sql_upper:
            warnings.append("Query has no LIMIT clause - may return many rows")

        # Check for potential performance issues
        if "ST_DISTANCE" in sql_upper and "ST_TRANSFORM" not in sql_upper:
            warnings.append(
                "Using ST_Distance without ST_Transform may give inaccurate results "
                "for geographic coordinates"
            )

        return warnings


def get_available_providers() -> list[LLMProvider]:
    """Get list of available LLM providers.

    Returns:
        List of LLMProvider objects
    """
    providers = []

    # Check Ollama
    ollama_client = OllamaClient()
    ollama_available = ollama_client.is_available()

    providers.append(
        LLMProvider(
            name="Ollama",
            type="ollama",
            url="http://localhost:11434",
            model="llama3.2",
            available=ollama_available,
        )
    )

    return providers


def get_schema_context(
    service_name: str,
    schema: str = "public",
) -> str:
    """Get schema context for AI query generation.

    Args:
        service_name: PostgreSQL service name
        schema: Schema to describe

    Returns:
        Schema description string
    """
    from apps.postgres.schema import get_table_columns, list_tables

    try:
        tables = list_tables(service_name, schema)

        context_parts = []
        for table in tables:
            table_name = table["name"]
            columns = get_table_columns(service_name, schema, table_name)

            col_desc = []
            for col in columns:
                col_str = f"  - {col['name']}: {col['dataType']}"
                if col.get("isPrimaryKey"):
                    col_str += " (PK)"
                if col.get("isGeometry"):
                    col_str += f" ({col.get('geometryType', 'geometry')})"
                col_desc.append(col_str)

            context_parts.append(f"Table: {schema}.{table_name}")
            context_parts.extend(col_desc)
            context_parts.append("")

        return "\n".join(context_parts)
    except Exception as e:
        return f"Error getting schema: {e}"
