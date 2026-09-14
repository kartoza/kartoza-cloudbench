"""URL configuration for GeoNode app."""

from django.urls import path

from . import views

urlpatterns = [
    # GeoNode Connections
    path(
        "geonode/connections",
        views.GeoNodeConnectionListView.as_view(),
        name="geonode-connection-list",
    ),
    path(
        "geonode/connections/test",
        views.GeoNodeConnectionTestView.as_view(),
        name="geonode-connection-test",
    ),
    path(
        "geonode/connections/<str:conn_id>",
        views.GeoNodeConnectionDetailView.as_view(),
        name="geonode-connection-detail",
    ),
    # Upload
    path(
        "geonode/upload/complete",
        views.GeoNodeUploadCompleteView.as_view(),
        name="geonode-upload-complete",
    ),
    # Remote services
    path(
        "geonode/connections/<str:conn_id>/remote-services",
        views.GeoNodeRemoteServiceListView.as_view(),
        name="geonode-remote-service-list",
    ),
    path(
        "geonode/connections/<str:conn_id>/remote-services/<str:geoserver_conn_id>/connect",
        views.GeoNodeRemoteServiceConnectView.as_view(),
        name="geonode-remote-service-connect",
    ),
    path(
        "geonode/connections/<str:conn_id>/remote-services/<int:service_id>/resources",
        views.GeoNodeRemoteServiceResourcesView.as_view(),
        name="geonode-remote-service-resources",
    ),
    path(
        "geonode/connections/<str:conn_id>/remote-services/<int:service_id>/import",
        views.GeoNodeRemoteServiceImportView.as_view(),
        name="geonode-remote-service-import",
    ),
    path(
        "geonode/connections/<str:conn_id>/remote-services/<int:service_id>",
        views.GeoNodeRemoteServiceDeleteView.as_view(),
        name="geonode-remote-service-delete",
    ),
    # URL test
    path(
        "geonode/connections/<str:conn_id>/test",
        views.GeoNodeTestView.as_view(),
        name="geonode-connection-url-test",
    ),
    # Categories
    path(
        "geonode/connections/<str:conn_id>/categories",
        views.GeoNodeCategoryListView.as_view(),
        name="geonode-category-list",
    ),
    # Resources
    path(
        "geonode/connections/<str:conn_id>/<str:resource_type>",
        views.GeoNodeResourceListView.as_view(),
        name="geonode-resource-list",
    ),
    path(
        "geonode/connections/<str:conn_id>/<str:resource_type>/<str:resource_id>",
        views.GeoNodeResourceDetailView.as_view(),
        name="geonode-resource-detail",
    ),
]
