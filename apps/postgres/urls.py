"""URL configuration for PostgreSQL app."""

from django.urls import path

from . import views

urlpatterns = [
    # PostgreSQL Services
    path(
        "pg/services",
        views.PGServiceListView.as_view(),
        name="pg-service-list",
    ),
    path(
        "pg/services/<str:name>",
        views.PGServiceDetailView.as_view(),
        name="pg-service-detail",
    ),
    path(
        "pg/services/<str:name>/test",
        views.PGServiceTestView.as_view(),
        name="pg-service-test",
    ),
    path(
        "pg/services/<str:name>/stats",
        views.PGServiceStatsView.as_view(),
        name="pg-service-stats",
    ),
    # Schema and Tables - use service_name to match view parameter
    path(
        "pg/services/<str:service_name>/database-names",
        views.PGDatabaseNameListView.as_view(),
        name="pg-database-names",
    ),
    path(
        "pg/services/<str:service_name>/schema-names/<str:database_name>",
        views.PGSchemaNameListView.as_view(),
        name="pg-schema-names",
    ),
    path(
        "pg/services/<str:service_name>/schemas",
        views.PGSchemaListView.as_view(),
        name="pg-schema-list",
    ),
    path(
        "pg/services/<str:service_name>/schemas/<str:schema_name>/stats",
        views.PGSchemaStatsView.as_view(),
        name="pg-schema-stats",
    ),
    path(
        "pg/services/<str:service_name>/schemas/<str:schema_name>/tables",
        views.PGTableListView.as_view(),
        name="pg-table-list",
    ),
    path(
        "pg/services/<str:service_name>/schemas/<str:schema_name>/tables/<str:table_name>",
        views.PGTableDetailView.as_view(),
        name="pg-table-detail",
    ),
    path(
        "pg/services/<str:service_name>/schemas/<str:schema_name>/tables/<str:table_name>/data",
        views.PGTableDataView.as_view(),
        name="pg-table-data",
    ),
    # Queries
    path(
        "pg/services/<str:service_name>/query",
        views.PGQueryView.as_view(),
        name="pg-query",
    ),
    # Upload complete (assemble only, file kept for detect-layers)
    path(
        "pg/upload/complete",
        views.PGUploadCompleteView.as_view(),
        name="pg-upload-complete",
    ),
    # Import
    path(
        "pg/import",
        views.PGImportView.as_view(),
        name="pg-import",
    ),
    path(
        "pg/import/raster",
        views.PGImportRasterView.as_view(),
        name="pg-import-raster",
    ),
    path(
        "pg/import/<str:job_id>",
        views.PGImportStatusView.as_view(),
        name="pg-import-status",
    ),
    # Layer Detection
    path(
        "pg/detect-layers",
        views.PGDetectLayersView.as_view(),
        name="pg-detect-layers",
    ),
    # OGR2OGR
    path(
        "pg/ogr2ogr/status",
        views.OGR2OGRStatusView.as_view(),
        name="pg-ogr2ogr-status",
    ),
]
