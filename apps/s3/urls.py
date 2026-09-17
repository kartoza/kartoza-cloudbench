"""URL configuration for S3 app."""

from django.urls import path, re_path

from . import views

urlpatterns = [
    # S3 Connections
    path(
        "s3/connections",
        views.S3ConnectionListView.as_view(),
        name="s3-connection-list",
    ),
    path(
        "s3/connections/test",
        views.S3ConnectionTestView.as_view(),
        name="s3-connection-test",
    ),
    path(
        "s3/connections/<str:conn_id>",
        views.S3ConnectionDetailView.as_view(),
        name="s3-connection-detail",
    ),
    path(
        "s3/connections/<str:conn_id>/test",
        views.S3ConnectionTestExistingView.as_view(),
        name="s3-connection-test-existing",
    ),
    # Buckets
    path(
        "s3/connections/<str:conn_id>/buckets",
        views.S3BucketListView.as_view(),
        name="s3-bucket-list",
    ),
    path(
        "s3/connections/<str:conn_id>/buckets/<str:bucket>",
        views.S3BucketDetailView.as_view(),
        name="s3-bucket-detail",
    ),
    # Objects
    path(
        "s3/objects/<str:conn_id>/<str:bucket>",
        views.S3ObjectListView.as_view(),
        name="s3-object-list",
    ),
    re_path(
        r"^s3/objects/(?P<conn_id>[^/]+)/(?P<bucket>[^/]+)/(?P<key>.+)$",
        views.S3ObjectDetailView.as_view(),
        name="s3-object-detail",
    ),
    # Preview and Proxy
    re_path(
        r"^s3/preview/(?P<conn_id>[^/]+)/(?P<bucket>[^/]+)/(?P<key>.+)$",
        views.S3PreviewView.as_view(),
        name="s3-preview",
    ),
    re_path(
        r"^s3/proxy/(?P<conn_id>[^/]+)/(?P<bucket>[^/]+)/(?P<key>.+)$",
        views.S3ProxyView.as_view(),
        name="s3-proxy",
    ),
    re_path(
        r"^s3/geojson/(?P<conn_id>[^/]+)/(?P<bucket>[^/]+)/(?P<key>.+)$",
        views.S3GeoJSONView.as_view(),
        name="s3-geojson",
    ),
    # DuckDB
    path(
        "s3/duckdb/",
        views.S3DuckDBQueryView.as_view(),
        name="s3-duckdb-query",
    ),
    # Conversion
    path(
        "s3/conversion/tools",
        views.S3ConversionToolsView.as_view(),
        name="s3-conversion-tools",
    ),
    path(
        "s3/conversion/jobs",
        views.S3ConversionJobsView.as_view(),
        name="s3-conversion-jobs",
    ),
    path(
        "s3/conversion/jobs/<str:job_id>",
        views.S3ConversionJobsView.as_view(),
        name="s3-conversion-job-detail",
    ),
    # Upload
    path(
        "s3/upload/<str:conn_id>/<str:bucket>",
        views.S3UploadView.as_view(),
        name="s3-upload",
    ),
    # Presigned URLs
    re_path(
        r"^s3/presigned/(?P<conn_id>[^/]+)/(?P<bucket>[^/]+)/(?P<key>.+)$",
        views.S3PresignedURLView.as_view(),
        name="s3-presigned-url",
    ),
]
