"""URL configuration for core app."""

from django.urls import path

from . import geohosting_bridge, views

urlpatterns = [
    path("settings/", views.SettingsView.as_view(), name="settings"),
    path("providers/", views.ProvidersView.as_view(), name="providers"),
    path(
        "geohosting/instances/",
        geohosting_bridge.GeoHostingInstanceView.as_view(),
        name="geohosting-instances",
    ),
    path(
        "geohosting/instances/<str:instance_id>/",
        geohosting_bridge.GeoHostingInstanceView.as_view(),
        name="geohosting-instance-detail",
    ),
]
