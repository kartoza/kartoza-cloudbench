package s3client

import "time"

// BucketInfo contains information about an S3 bucket
type BucketInfo struct {
	Name         string    `json:"name"`
	CreationDate time.Time `json:"creation_date"`
}

// ObjectInfo contains information about an S3 object
type ObjectInfo struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"last_modified"`
	ContentType  string    `json:"content_type,omitempty"`
	ETag         string    `json:"etag,omitempty"`
	IsDir        bool      `json:"is_dir"` // Virtual folder (prefix ending with /)
}

// PutOptions contains options for uploading objects
type PutOptions struct {
	ContentType string            // MIME type of the object
	Metadata    map[string]string // User-defined metadata
}

// ProgressCallback is called during long-running operations with progress updates
type ProgressCallback func(bytesTransferred int64, totalBytes int64)

// ConnectionTestResult contains the result of a connection test
type ConnectionTestResult struct {
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	BucketCount  int    `json:"bucket_count,omitempty"`
	ServerInfo   string `json:"server_info,omitempty"`
}

// CloudNativeFormat represents a cloud-native geospatial format
type CloudNativeFormat string

const (
	FormatCOG        CloudNativeFormat = "cog"        // Cloud Optimized GeoTIFF
	FormatCOPC       CloudNativeFormat = "copc"       // Cloud Optimized Point Cloud
	FormatGeoParquet CloudNativeFormat = "geoparquet" // GeoParquet
	FormatUnknown    CloudNativeFormat = "unknown"
)

// DetectCloudNativeFormat detects if a file is a known cloud-native format based on extension
func DetectCloudNativeFormat(key string) CloudNativeFormat {
	// Check for common cloud-native format indicators
	switch {
	case hasSuffix(key, ".cog.tif"), hasSuffix(key, ".cog.tiff"):
		return FormatCOG
	case hasSuffix(key, ".copc.laz"):
		return FormatCOPC
	case hasSuffix(key, ".parquet"), hasSuffix(key, ".geoparquet"):
		return FormatGeoParquet
	default:
		return FormatUnknown
	}
}

// hasSuffix checks if a string ends with the given suffix (case-insensitive)
func hasSuffix(s, suffix string) bool {
	if len(s) < len(suffix) {
		return false
	}
	return toLower(s[len(s)-len(suffix):]) == toLower(suffix)
}

// toLower converts a string to lowercase (simple ASCII implementation)
func toLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}
