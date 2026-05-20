"""URL configuration for GeoServer app."""

from django.urls import path

from . import views

urlpatterns = [
    # Workspaces
    path(
        "workspaces/<str:conn_id>",
        views.WorkspaceListView.as_view(),
        name="workspace-list",
    ),
    path(
        "workspaces/<str:conn_id>/<str:workspace>",
        views.WorkspaceDetailView.as_view(),
        name="workspace-detail",
    ),
    # Data Stores
    path(
        "datastores/<str:conn_id>/<str:workspace>",
        views.DataStoreListView.as_view(),
        name="datastore-list",
    ),
    path(
        "datastores/<str:conn_id>/<str:workspace>/connect/<str:pg_conn_id>",
        views.DataStoreConnectPGView.as_view(),
        name="datastore-connect-pg",
    ),
    path(
        "datastores/<str:conn_id>/<str:workspace>/<str:store>",
        views.DataStoreDetailView.as_view(),
        name="datastore-detail",
    ),
    path(
        "datastores/<str:conn_id>/<str:workspace>/<str:store>/available",
        views.DataStoreAvailableView.as_view(),
        name="datastore-available",
    ),
    path(
        "datastores/<str:conn_id>/<str:workspace>/<str:store>/publish",
        views.DataStorePublishView.as_view(),
        name="datastore-publish",
    ),
    # Coverage Stores
    path(
        "coveragestores/<str:conn_id>/<str:workspace>",
        views.CoverageStoreListView.as_view(),
        name="coveragestore-list",
    ),
    path(
        "coveragestores/<str:conn_id>/<str:workspace>/<str:store>",
        views.CoverageStoreDetailView.as_view(),
        name="coveragestore-detail",
    ),
    # Feature Types
    path(
        "featuretypes/<str:conn_id>/<str:workspace>/<str:store>",
        views.FeatureTypeListView.as_view(),
        name="featuretype-list",
    ),
    path(
        "featuretypes/<str:conn_id>/<str:workspace>/<str:store>/<str:featuretype>",
        views.FeatureTypeDetailView.as_view(),
        name="featuretype-detail",
    ),
    # Coverages
    path(
        "coverages/<str:conn_id>/<str:workspace>/<str:store>",
        views.CoverageListView.as_view(),
        name="coverage-list",
    ),
    path(
        "coverages/<str:conn_id>/<str:workspace>/<str:store>/<str:coverage>",
        views.CoverageDetailView.as_view(),
        name="coverage-detail",
    ),
    # Layers
    path(
        "layers/<str:conn_id>/<str:workspace>",
        views.LayerListView.as_view(),
        name="layer-list",
    ),
    path(
        "layers/<str:conn_id>/<str:workspace>/<str:layer>",
        views.LayerDetailView.as_view(),
        name="layer-detail",
    ),
    path(
        "layers/<str:conn_id>/<str:workspace>/<str:layer>/count",
        views.LayerCountView.as_view(),
        name="layer-count",
    ),
    # Layer Metadata
    path(
        "layermetadata/<str:conn_id>/<str:workspace>/<str:layer>",
        views.LayerMetadataView.as_view(),
        name="layer-metadata",
    ),
    # Layer Styles
    path(
        "layerstyles/<str:conn_id>/<str:workspace>/<str:layer>",
        views.LayerStylesView.as_view(),
        name="layer-styles",
    ),
    # Styles
    path(
        "styles/<str:conn_id>/<str:workspace>",
        views.StyleListView.as_view(),
        name="style-list",
    ),
    path(
        "styles/<str:conn_id>/<str:workspace>/<str:style>",
        views.StyleDetailView.as_view(),
        name="style-detail",
    ),
    # Layer Groups
    path(
        "layergroups/<str:conn_id>/<str:workspace>",
        views.LayerGroupListView.as_view(),
        name="layergroup-list",
    ),
    path(
        "layergroups/<str:conn_id>/<str:workspace>/<str:layergroup>",
        views.LayerGroupDetailView.as_view(),
        name="layergroup-detail",
    ),
    # Chunked upload → background task flow
    path(
        "upload/complete/<str:conn_id>/<str:workspace>",
        views.GeoServerUploadCompleteView.as_view(),
        name="geoserver-upload-complete",
    ),
    path(
        "upload/start/<str:conn_id>/<str:workspace>",
        views.GeoServerUploadStartView.as_view(),
        name="geoserver-upload-start",
    ),
    path(
        "upload/status/<str:job_id>",
        views.GeoServerUploadStatusView.as_view(),
        name="geoserver-upload-status",
    ),
]
