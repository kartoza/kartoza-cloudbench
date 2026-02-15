package llm

import "errors"

var (
	// ErrNoProvider indicates no LLM provider is available
	ErrNoProvider = errors.New("no LLM provider available")

	// ErrProviderUnavailable indicates the provider is not available
	ErrProviderUnavailable = errors.New("LLM provider is not available")

	// ErrInvalidQuery indicates the query could not be processed
	ErrInvalidQuery = errors.New("invalid query")

	// ErrGenerationFailed indicates SQL generation failed
	ErrGenerationFailed = errors.New("SQL generation failed")

	// ErrSchemaNotFound indicates the schema was not found
	ErrSchemaNotFound = errors.New("schema not found")

	// ErrTableNotFound indicates a table was not found
	ErrTableNotFound = errors.New("table not found")

	// ErrConnectionFailed indicates database connection failed
	ErrConnectionFailed = errors.New("database connection failed")

	// ErrQueryExecution indicates query execution failed
	ErrQueryExecution = errors.New("query execution failed")

	// ErrTimeout indicates the operation timed out
	ErrTimeout = errors.New("operation timed out")

	// ErrRateLimited indicates the provider rate limited the request
	ErrRateLimited = errors.New("rate limited by provider")

	// ErrUnsafeQuery indicates the generated query is potentially unsafe
	ErrUnsafeQuery = errors.New("generated query is potentially unsafe")
)
