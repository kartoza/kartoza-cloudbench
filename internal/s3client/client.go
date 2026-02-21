package s3client

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/kartoza/kartoza-cloudbench/internal/config"
)

// Client wraps the MinIO client for S3-compatible storage operations
type Client struct {
	mc       *minio.Client
	endpoint string
	connID   string
	useSSL   bool
}

// NewClient creates a new S3 client from a connection configuration
func NewClient(conn *config.S3Connection) (*Client, error) {
	mc, err := minio.New(conn.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(conn.AccessKey, conn.SecretKey, ""),
		Secure: conn.UseSSL,
		Region: conn.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create S3 client: %w", err)
	}

	// Note: minio-go v7 automatically uses path-style addressing when the endpoint
	// is not an AWS S3 endpoint, so no additional configuration is needed for PathStyle

	return &Client{
		mc:       mc,
		endpoint: conn.Endpoint,
		connID:   conn.ID,
		useSSL:   conn.UseSSL,
	}, nil
}

// NewClientDirect creates a new S3 client with direct parameters (for testing connections)
func NewClientDirect(endpoint, accessKey, secretKey, region string, useSSL, pathStyle bool) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: region,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create S3 client: %w", err)
	}

	return &Client{
		mc:       mc,
		endpoint: endpoint,
		useSSL:   useSSL,
	}, nil
}

// TestConnection tests the S3 connection by listing buckets
func (c *Client) TestConnection(ctx context.Context) (*ConnectionTestResult, error) {
	buckets, err := c.mc.ListBuckets(ctx)
	if err != nil {
		return &ConnectionTestResult{
			Success: false,
			Message: fmt.Sprintf("Connection failed: %v", err),
		}, err
	}

	return &ConnectionTestResult{
		Success:     true,
		Message:     fmt.Sprintf("Connected successfully. Found %d bucket(s).", len(buckets)),
		BucketCount: len(buckets),
	}, nil
}

// ListBuckets returns a list of all buckets
func (c *Client) ListBuckets(ctx context.Context) ([]BucketInfo, error) {
	buckets, err := c.mc.ListBuckets(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list buckets: %w", err)
	}

	result := make([]BucketInfo, len(buckets))
	for i, b := range buckets {
		result[i] = BucketInfo{
			Name:         b.Name,
			CreationDate: b.CreationDate,
		}
	}
	return result, nil
}

// CreateBucket creates a new bucket
func (c *Client) CreateBucket(ctx context.Context, bucketName string) error {
	err := c.mc.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
	if err != nil {
		// Check if bucket already exists
		exists, errExists := c.mc.BucketExists(ctx, bucketName)
		if errExists == nil && exists {
			return nil // Bucket already exists, not an error
		}
		return fmt.Errorf("failed to create bucket: %w", err)
	}
	return nil
}

// DeleteBucket deletes an empty bucket
func (c *Client) DeleteBucket(ctx context.Context, bucketName string) error {
	err := c.mc.RemoveBucket(ctx, bucketName)
	if err != nil {
		return fmt.Errorf("failed to delete bucket: %w", err)
	}
	return nil
}

// BucketExists checks if a bucket exists
func (c *Client) BucketExists(ctx context.Context, bucketName string) (bool, error) {
	return c.mc.BucketExists(ctx, bucketName)
}

// ListObjects lists objects in a bucket with an optional prefix
func (c *Client) ListObjects(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error) {
	opts := minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: false, // Only list immediate children
	}

	var objects []ObjectInfo
	objectCh := c.mc.ListObjects(ctx, bucket, opts)

	for obj := range objectCh {
		if obj.Err != nil {
			return nil, fmt.Errorf("error listing objects: %w", obj.Err)
		}

		// Determine if this is a "folder" (common prefix)
		isDir := strings.HasSuffix(obj.Key, "/")

		objects = append(objects, ObjectInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ContentType:  obj.ContentType,
			ETag:         obj.ETag,
			IsDir:        isDir,
		})
	}

	return objects, nil
}

// ListObjectsRecursive lists all objects in a bucket recursively
func (c *Client) ListObjectsRecursive(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error) {
	opts := minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}

	var objects []ObjectInfo
	objectCh := c.mc.ListObjects(ctx, bucket, opts)

	for obj := range objectCh {
		if obj.Err != nil {
			return nil, fmt.Errorf("error listing objects: %w", obj.Err)
		}

		objects = append(objects, ObjectInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ContentType:  obj.ContentType,
			ETag:         obj.ETag,
			IsDir:        strings.HasSuffix(obj.Key, "/"),
		})
	}

	return objects, nil
}

// GetObject retrieves an object from S3
func (c *Client) GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	obj, err := c.mc.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get object: %w", err)
	}
	return obj, nil
}

// GetObjectInfo retrieves metadata about an object without downloading it
func (c *Client) GetObjectInfo(ctx context.Context, bucket, key string) (*ObjectInfo, error) {
	stat, err := c.mc.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to stat object: %w", err)
	}

	return &ObjectInfo{
		Key:          stat.Key,
		Size:         stat.Size,
		LastModified: stat.LastModified,
		ContentType:  stat.ContentType,
		ETag:         stat.ETag,
		IsDir:        false,
	}, nil
}

// PutObject uploads an object to S3
func (c *Client) PutObject(ctx context.Context, bucket, key string, reader io.Reader, size int64, opts PutOptions) error {
	putOpts := minio.PutObjectOptions{
		ContentType:  opts.ContentType,
		UserMetadata: opts.Metadata,
	}

	_, err := c.mc.PutObject(ctx, bucket, key, reader, size, putOpts)
	if err != nil {
		return fmt.Errorf("failed to put object: %w", err)
	}
	return nil
}

// PutObjectWithProgress uploads an object with progress callback
func (c *Client) PutObjectWithProgress(ctx context.Context, bucket, key string, reader io.Reader, size int64, opts PutOptions, progress ProgressCallback) error {
	putOpts := minio.PutObjectOptions{
		ContentType:  opts.ContentType,
		UserMetadata: opts.Metadata,
		Progress:     &progressReader{callback: progress, total: size},
	}

	_, err := c.mc.PutObject(ctx, bucket, key, reader, size, putOpts)
	if err != nil {
		return fmt.Errorf("failed to put object: %w", err)
	}
	return nil
}

// progressReader implements io.Reader to track upload progress
type progressReader struct {
	callback    ProgressCallback
	total       int64
	transferred int64
}

func (pr *progressReader) Read(p []byte) (int, error) {
	return len(p), nil // Not actually reading, just tracking
}

// DeleteObject deletes an object from S3
func (c *Client) DeleteObject(ctx context.Context, bucket, key string) error {
	err := c.mc.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete object: %w", err)
	}
	return nil
}

// DeleteObjects deletes multiple objects from S3
func (c *Client) DeleteObjects(ctx context.Context, bucket string, keys []string) error {
	objectsCh := make(chan minio.ObjectInfo, len(keys))

	go func() {
		defer close(objectsCh)
		for _, key := range keys {
			objectsCh <- minio.ObjectInfo{Key: key}
		}
	}()

	for err := range c.mc.RemoveObjects(ctx, bucket, objectsCh, minio.RemoveObjectsOptions{}) {
		if err.Err != nil {
			return fmt.Errorf("failed to delete object %s: %w", err.ObjectName, err.Err)
		}
	}
	return nil
}

// GetPresignedURL generates a presigned URL for downloading an object
func (c *Client) GetPresignedURL(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	presignedURL, err := c.mc.PresignedGetObject(ctx, bucket, key, expires, nil)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned URL: %w", err)
	}
	return presignedURL.String(), nil
}

// GetPresignedUploadURL generates a presigned URL for uploading an object
func (c *Client) GetPresignedUploadURL(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	presignedURL, err := c.mc.PresignedPutObject(ctx, bucket, key, expires)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned upload URL: %w", err)
	}
	return presignedURL.String(), nil
}

// CopyObject copies an object within S3
func (c *Client) CopyObject(ctx context.Context, srcBucket, srcKey, dstBucket, dstKey string) error {
	src := minio.CopySrcOptions{
		Bucket: srcBucket,
		Object: srcKey,
	}
	dst := minio.CopyDestOptions{
		Bucket: dstBucket,
		Object: dstKey,
	}

	_, err := c.mc.CopyObject(ctx, dst, src)
	if err != nil {
		return fmt.Errorf("failed to copy object: %w", err)
	}
	return nil
}

// GetEndpoint returns the S3 endpoint URL
func (c *Client) GetEndpoint() string {
	protocol := "http"
	if c.useSSL {
		protocol = "https"
	}
	return fmt.Sprintf("%s://%s", protocol, c.endpoint)
}

// BuildObjectURL builds a direct URL to an object (not presigned)
func (c *Client) BuildObjectURL(bucket, key string) string {
	protocol := "http"
	if c.useSSL {
		protocol = "https"
	}
	return fmt.Sprintf("%s://%s/%s/%s", protocol, c.endpoint, bucket, url.PathEscape(key))
}

// GetConnectionID returns the connection ID associated with this client
func (c *Client) GetConnectionID() string {
	return c.connID
}

// GetObjectRange retrieves a range of bytes from an S3 object
func (c *Client) GetObjectRange(ctx context.Context, bucket, key string, offset, length int64) ([]byte, error) {
	opts := minio.GetObjectOptions{}
	opts.SetRange(offset, offset+length-1)

	obj, err := c.mc.GetObject(ctx, bucket, key, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to get object range: %w", err)
	}
	defer obj.Close()

	data, err := io.ReadAll(io.LimitReader(obj, length))
	if err != nil {
		return nil, fmt.Errorf("failed to read object range: %w", err)
	}
	return data, nil
}
