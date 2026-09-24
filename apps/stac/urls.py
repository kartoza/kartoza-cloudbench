"""URL configuration for the STAC catalogue app."""

from django.urls import path, re_path

from . import views

urlpatterns = [
    path("stac/", views.StacRootView.as_view(), name="stac-root"),
    path("stac/collections", views.StacCollectionListView.as_view(), name="stac-collection-list"),
    path(
        "stac/collections/<str:collection_id>",
        views.StacCollectionDetailView.as_view(),
        name="stac-collection-detail",
    ),
    path(
        "stac/collections/<str:collection_id>/items",
        views.StacItemListView.as_view(),
        name="stac-item-list",
    ),
    re_path(
        r"^stac/collections/(?P<collection_id>[^/]+)/items/(?P<item_id>.+)$",
        views.StacItemDetailView.as_view(),
        name="stac-item-detail",
    ),
]
