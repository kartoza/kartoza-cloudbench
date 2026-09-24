"""URL configuration for core app."""

from django.urls import path

from . import geohosting_bridge, views

urlpatterns = [
    # Standalone login (no GeoHosting) — trades a username/password for a
    # DRF auth token, using the same `Authorization: Token <value>` shape
    # the frontend already sends on every request (see
    # web/src/api/common.ts) and the SSO handoff already produces, so no
    # frontend request-plumbing is SSO-specific.
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("frontend-config/", views.FrontendConfigView.as_view(), name="frontend-config"),
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
    path(
        "geohosting/sso-token/",
        geohosting_bridge.GeoHostingSSOTokenView.as_view(),
        name="geohosting-sso-token",
    ),
]
